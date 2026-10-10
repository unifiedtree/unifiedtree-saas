// Shift planner (design §1.6), the pure half: the draft's state and reducer (steps, rows, edits), dirty tracking,
// the undo stack, which change lays the pattern again (regenerate) and which only refreshes the preview, the wire
// bodies, and the grid's view model from a PlanResponse. Free of React so vitest covers it.
//
// No planning rule lives here. Rotation positions, staggered start days, coverage and the checks are the server's
// (RosterPlanner, through POST /v1/rosters/preview); the web only keeps the working copy, paints a hand edit at once
// and asks the server again.
import { MON, MONTHS } from '@/design/dc/dates'
import {
  WO_TOKEN,
  type CellToken, type Checks, type DraftBody, type ISODate, type Issue, type MemberIn, type PatternDay, type PlanCell,
  type PlanRequest, type PlanResponse, type PlanRow, type PlannerPerson, type RosterConfig, type RosterDetail,
  type RosterSummary, type RowIn, type StaffingIn, type StaggerMode, type WeeklyOffMode,
} from '../../api/rosterTypes'
import type { ShiftPolicy } from '../../api/useShiftPolicies'
import { hhmm, overnight, span } from '../shifts/shiftModel'

// ── Dates (ISO strings, India dates; worked out in UTC so no time zone can shift a day) ─────────────────────

const utc = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }
const isoUtc = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
export const addDaysIso = (iso: string, n: number) => isoUtc(utc(iso) + n * 86_400_000)
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000)
/** Days in start…end, both included. */
export const periodLength = (start: string, end: string) => Math.max(0, daysBetween(start, end) + 1)
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (iso: string) => ((new Date(utc(iso)).getUTCDay() + 6) % 7) + 1
export const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export function periodDates(start: string, end: string): ISODate[] {
  const n = periodLength(start, end)
  return Array.from({ length: n }, (_, i) => addDaysIso(start, i))
}
/** "2026-10" → 1 … 31 Oct. */
export function monthPeriod(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`
  return { startDate, endDate: addDaysIso(isoUtc(Date.UTC(y, m, 1)), -1) }
}
/** The longest roster (design §1.1: end − start ≤ 61). */
export const MAX_DAYS = 62
/** Why a period can't be planned, or null. */
export function rangeProblem(start: string, end: string): string | null {
  if (!start || !end) return 'Pick the first and last day.'
  if (end < start) return 'The last day is before the first day.'
  if (periodLength(start, end) > MAX_DAYS) return `A roster covers at most ${MAX_DAYS} days.`
  return null
}
const dShort = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}` }
/** "1 – 14 Oct 2026", "28 Sep – 11 Oct 2026", "October 2026" for a whole month. */
export function periodLabel(start: string, end: string) {
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2] = end.split('-').map(Number)
  const whole = d1 === 1 && start.slice(0, 7) === end.slice(0, 7) && monthPeriod(start.slice(0, 7)).endDate === end
  if (whole) return `${MONTHS[m1 - 1]} ${y1}`
  if (y1 === y2 && m1 === m2) return `${d1} – ${dShort(end)} ${y2}`
  return y1 === y2 ? `${dShort(start)} – ${dShort(end)} ${y2}` : `${dShort(start)} ${y1} – ${dShort(end)} ${y2}`
}
/** "October 2026" + the scope ("October 2026 – Technical"), the name a new roster starts with. */
export function defaultRosterName(start: string, end: string, scope?: string | null) {
  const base = periodLabel(start, end)
  return scope ? `${base} – ${scope}` : base
}

// ── Shifts as the planner shows them ─────────────────────────────────────────────────────────────────

export interface ShiftLite {
  id: string
  /** The roster code: the shift's code, else its name's first letters. */
  code: string
  /** False when the shift has no code of its own (it can't be used in imports). */
  hasCode: boolean
  name: string
  start: string
  end: string
  night: boolean
  /** Break, as today's shift drawer derives it: length − working hours. */
  breakMinutes: number
  people: number | null
  /** Colour slot for the legend and cells: night, or 1…6 in order. */
  tone: string
}

/** "General shift" → "GS", "Morning" → "M". */
export const initials = (name: string) => name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

/** The company's shifts for the planner, in start-time order, each with a colour slot. */
export function toShiftLites(policies: readonly ShiftPolicy[]): ShiftLite[] {
  let slot = 0
  return [...policies]
    .sort((a, b) => hhmm(a.startTime).localeCompare(hhmm(b.startTime)) || a.name.localeCompare(b.name))
    .map((p) => {
      const night = p.shiftType === 'NIGHT' || overnight(p.startTime, p.endTime)
      const code = p.code?.trim()
      return {
        id: p.id, code: code || initials(p.name), hasCode: !!code, name: p.name, start: hhmm(p.startTime), end: hhmm(p.endTime), night,
        breakMinutes: p.workingHoursPerDay ? Math.max(0, span(p.startTime, p.endTime) - Math.round(p.workingHoursPerDay * 60)) : 0,
        people: typeof p.employeeCount === 'number' ? p.employeeCount : null,
        tone: night ? 'night' : String((slot++ % 6) + 1),
      }
    })
}

/** A cell token's code: "WO", the shift's code, or null for an empty cell. */
export function tokenCode(token: CellToken, shifts: ReadonlyMap<string, ShiftLite>, fallback?: string | null): string | null {
  if (token == null) return null
  if (token === WO_TOKEN) return 'WO'
  return shifts.get(token)?.code ?? fallback ?? '?'
}

/**
 * What a typed key means in the grid: W (or WO) = weekly off, otherwise a shift whose code is what was typed, or
 * the only one starting with it. Null when nothing (or more than one) matches.
 */
export function tokenForTyped(typed: string, shifts: readonly ShiftLite[]): CellToken | undefined {
  const t = typed.trim().toUpperCase()
  if (!t) return undefined
  if (t === 'W' || t === 'WO') return WO_TOKEN
  const exact = shifts.find((s) => s.code.toUpperCase() === t)
  if (exact) return exact.id
  const pre = shifts.filter((s) => s.code.toUpperCase().startsWith(t))
  return pre.length === 1 ? pre[0].id : undefined
}

// ── Patterns ────────────────────────────────────────────────────────────────────────────────────────

export const MAX_PATTERN_DAYS = 62
export const patternDay = (token: CellToken): PatternDay => (token === WO_TOKEN || token == null ? { shiftPolicyId: null, weeklyOff: true } : { shiftPolicyId: token, weeklyOff: false })
export const patternToken = (d: PatternDay): CellToken => (d.weeklyOff || !d.shiftPolicyId ? WO_TOKEN : d.shiftPolicyId)
export const patternCodes = (days: readonly PatternDay[], shifts: ReadonlyMap<string, ShiftLite>) => days.map((d) => tokenCode(patternToken(d), shifts) ?? '?')
/** The pattern laid out `cycles` times, for the strip under the builder. */
export const patternStrip = (days: readonly PatternDay[], repeats: boolean, cycles = 2) => (repeats ? Array.from({ length: cycles }, () => days).flat() : [...days])
export const samePattern = (a: readonly PatternDay[], b: readonly PatternDay[]) =>
  a.length === b.length && a.every((d, i) => patternToken(d) === patternToken(b[i]))
/** A note for the pattern under the chosen weekly-off mode (design §1.3), or null. */
export function patternNote(days: readonly PatternDay[], mode: WeeklyOffMode): string | null {
  if (!days.some((d) => d.weeklyOff)) return mode === 'ROTATIONAL' ? 'This pattern has no WO day, so no one gets a weekly off from it.' : null
  if (mode === 'FIXED') return 'With fixed weekly offs, people also get the pattern’s WO days off.'
  if (mode === 'CUSTOM') return 'The pattern’s WO days are left empty for you to pick in the preview.'
  return null
}

// ── The draft ───────────────────────────────────────────────────────────────────────────────────────

export type StepKey = 'period' | 'shifts' | 'pattern' | 'staffing' | 'people' | 'offs' | 'generate'
export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'period', label: 'Planning period' }, { key: 'shifts', label: 'Shifts' }, { key: 'pattern', label: 'Rotation pattern' },
  { key: 'staffing', label: 'Staffing' }, { key: 'people', label: 'People' }, { key: 'offs', label: 'Weekly offs and holidays' },
  { key: 'generate', label: 'Generate' },
]

/** A member. A null offset = no start day yet: sent as -1, and the server spreads it on the next regenerate. */
export interface DraftMember { employeeId: string; rotationOffset: number | null }
export interface DraftRow { cells: CellToken[]; edited: number[] }
export interface UndoCell { employeeId: string; index: number; token: CellToken; edited: boolean }
export interface UndoEntry { cells: UndoCell[] }
export const UNDO_LIMIT = 50

export interface PlannerState {
  rosterId: string | null
  lockVersion: number | null
  status: 'NEW' | 'DRAFT' | 'PUBLISHED'
  version: number
  hasUnpublishedChanges: boolean
  name: string
  /** The planner typed a name; until then it follows the period and scope. */
  nameTouched: boolean
  periodType: 'MONTH' | 'RANGE'
  startDate: ISODate
  endDate: ISODate
  departmentId: string | null
  branchId: string | null
  config: RosterConfig
  members: DraftMember[]
  staffing: StaffingIn[]
  /** The working copy by employee; cells[i] = startDate + i days. */
  rows: Record<string, DraftRow>
  /** "Keep my edits" (on by default): a regenerate keeps hand-edited cells. */
  keepEdits: boolean
  /** The first Generate happened (or the roster was loaded with days). Before it the preview shows names and the pattern only. */
  generated: boolean
  /** The next preview lays the pattern again (regenerate: true). */
  pendingRegenerate: boolean
  /** Bumps on every change the preview must see. */
  rev: number
  plan: PlanResponse | null
  /** The rev `plan` answers. */
  planRev: number
  undo: UndoEntry[]
  /** Signature of the last saved (or loaded) draft. */
  savedSig: string
  /** India today: a published roster's earlier days can't change (ROSTER_PAST_DAYS). */
  today: ISODate
}

export const emptyConfig = (): RosterConfig => ({
  templateId: null, pattern: [], repeats: true, weeklyOffMode: 'ROTATIONAL', staggerMode: 'SPREAD', continueFromRosterId: null,
  shiftIds: [], designationIds: [],
})

/** A new roster: this month, whole company, nothing chosen. */
export function initialState(today: ISODate, opts?: { departmentId?: string | null; scopeLabel?: string | null }): PlannerState {
  const { startDate, endDate } = monthPeriod(today.slice(0, 7))
  const s: PlannerState = {
    rosterId: null, lockVersion: null, status: 'NEW', version: 0, hasUnpublishedChanges: false,
    name: defaultRosterName(startDate, endDate, opts?.scopeLabel), nameTouched: false,
    periodType: 'MONTH', startDate, endDate, departmentId: opts?.departmentId ?? null, branchId: null,
    config: emptyConfig(), members: [], staffing: [], rows: {}, keepEdits: true, generated: false, pendingRegenerate: false,
    rev: 0, plan: null, planRev: 0, undo: [], savedSig: '', today,
  }
  return { ...s, savedSig: signature(s) }
}

const hasDays = (rows: readonly RowIn[]) => rows.some((r) => r.cells.some((c) => c != null))

/** The planner's state from a roster the server sent (open, save answer, discard, reload after publish). */
export function fromDetail(d: RosterDetail, today: ISODate): PlannerState {
  const r = d.roster
  const generated = hasDays(d.rows) || r.status === 'PUBLISHED'
  const n = periodLength(r.startDate, r.endDate)
  const rows: Record<string, DraftRow> = {}
  for (const row of d.rows) rows[row.employeeId] = { cells: fit(row.cells, n), edited: [...new Set(row.edited)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b) }
  const s: PlannerState = {
    rosterId: r.id, lockVersion: r.lockVersion, status: r.status, version: r.version, hasUnpublishedChanges: r.hasUnpublishedChanges,
    name: r.name, nameTouched: true, periodType: r.periodType, startDate: r.startDate, endDate: r.endDate,
    departmentId: r.departmentId, branchId: r.branchId,
    config: { ...emptyConfig(), ...r.config, pattern: r.config?.pattern ?? [], shiftIds: r.config?.shiftIds ?? [], designationIds: r.config?.designationIds ?? [] },
    // Offsets mean something only once days were laid; a draft saved before its first Generate has none chosen.
    members: d.members.map((m) => ({ employeeId: m.employeeId, rotationOffset: generated ? m.rotationOffset : null })),
    staffing: d.staffing.map((x) => ({ ...x })),
    rows, keepEdits: true, generated, pendingRegenerate: false, rev: 0, plan: d.plan ?? null, planRev: 0, undo: [], savedSig: '', today,
  }
  return { ...s, savedSig: signature(s) }
}

const fit = (cells: readonly CellToken[], n: number): CellToken[] => Array.from({ length: n }, (_, i) => cells[i] ?? null)

/** What a saved draft is made of, as one string: equal strings = nothing to save. */
export function signature(s: PlannerState): string {
  const staffing = [...s.staffing].filter((x) => x.required >= 0).sort((a, b) => `${a.designationId}|${a.shiftPolicyId}`.localeCompare(`${b.designationId}|${b.shiftPolicyId}`))
  return JSON.stringify([s.name.trim(), s.periodType, s.startDate, s.endDate, s.departmentId, s.branchId, s.config,
    s.members.map((m) => [m.employeeId, m.rotationOffset]), staffing, wireRows(s)])
}
export const isDirty = (s: PlannerState) => signature(s) !== s.savedSig

// ── Actions ─────────────────────────────────────────────────────────────────────────────────────────

export interface CellEdit { employeeId: string; index: number; token: CellToken }

export type PlannerAction =
  | { type: 'load'; detail: RosterDetail }
  | { type: 'name'; name: string }
  | { type: 'period'; periodType: 'MONTH' | 'RANGE'; startDate: ISODate; endDate: ISODate; scopeLabel?: string | null }
  | { type: 'scope'; departmentId: string | null; branchId: string | null; scopeLabel?: string | null }
  | { type: 'shifts'; shiftIds: string[] }
  | { type: 'pattern'; pattern: PatternDay[]; repeats: boolean; templateId: string | null }
  | { type: 'weeklyOffMode'; mode: WeeklyOffMode }
  | { type: 'stagger'; mode: StaggerMode; continueFromRosterId: string | null }
  | { type: 'designations'; designationIds: string[] }
  | { type: 'members'; employeeIds: string[] }
  | { type: 'required'; designationId: string; shiftPolicyId: string; required: number | null }
  | { type: 'staffing'; staffing: StaffingIn[] }
  | { type: 'generate' }
  | { type: 'keepEdits'; on: boolean }
  | { type: 'resetEdits' }
  | { type: 'cells'; edits: CellEdit[] }
  | { type: 'offset'; employeeId: string; offset: number }
  | { type: 'removeMember'; employeeId: string }
  | { type: 'undo' }
  /** Something outside the draft changed (a shift's times, a holiday added): ask the preview again. */
  | { type: 'refresh' }
  | { type: 'plan'; rev: number; regenerate: boolean; plan: PlanResponse }
  | { type: 'saved'; detail: RosterDetail; sentSig: string; sentRev: number }
  /** A new roster's defaults (shifts and people ticked for the planner) count as its starting point, not as changes. */
  | { type: 'baseline' }
  /** Start again with a new roster. */
  | { type: 'reset' }

/**
 * Which changes lay the pattern again (design §1.6 "Live"): pattern, weekly-off mode, people, start days and the
 * period → regenerate; staffing, shift ticks, cell edits → only refresh coverage and checks. Name and "Keep my
 * edits" don't touch the preview.
 */
export const PREVIEW_KIND: Record<PlannerAction['type'], 'regenerate' | 'refresh' | null> = {
  load: null, name: null, keepEdits: null, designations: null, plan: null, saved: null, baseline: null, reset: null,
  period: 'regenerate', scope: 'regenerate', pattern: 'regenerate', weeklyOffMode: 'regenerate', stagger: 'regenerate',
  members: 'regenerate', generate: 'regenerate', resetEdits: 'regenerate', offset: 'regenerate',
  shifts: 'refresh', required: 'refresh', staffing: 'refresh', cells: 'refresh', removeMember: 'refresh', undo: 'refresh', refresh: 'refresh',
}

/** Bumps rev for a change the preview must see; a regenerate only counts once the first Generate happened. */
function changed(s: PlannerState, next: Partial<PlannerState>, kind: 'regenerate' | 'refresh'): PlannerState {
  const out = { ...s, ...next }
  if (!out.generated) return out
  return { ...out, rev: s.rev + 1, pendingRegenerate: s.pendingRegenerate || kind === 'regenerate' }
}

/** With "Keep my edits" off, a regenerate lays every cell again: the edited marks go now, so later edits survive. */
const dropEdits = (rows: Record<string, DraftRow>, only?: string): Record<string, DraftRow> => {
  const out: Record<string, DraftRow> = {}
  for (const [k, r] of Object.entries(rows)) out[k] = only && k !== only ? r : { cells: r.cells, edited: [] }
  return out
}

/** Moves the working copy to a new period by date: a day still in the period keeps its cell. */
function realign(rows: Record<string, DraftRow>, oldStart: string, newStart: string, n: number): Record<string, DraftRow> {
  const shift = daysBetween(oldStart, newStart)
  const out: Record<string, DraftRow> = {}
  for (const [k, r] of Object.entries(rows)) {
    out[k] = {
      cells: Array.from({ length: n }, (_, i) => r.cells[i + shift] ?? null),
      edited: r.edited.map((i) => i - shift).filter((i) => i >= 0 && i < n),
    }
  }
  return out
}

/** Index of a published roster's first changeable day (today), or 0. */
export const firstOpenIndex = (s: Pick<PlannerState, 'status' | 'startDate' | 'today'>) =>
  (s.status === 'PUBLISHED' ? Math.max(0, daysBetween(s.startDate, s.today)) : 0)

/** The answer's cell for (person, day) when the answer is for this period. */
export function planCellAt(s: Pick<PlannerState, 'plan' | 'startDate'>, employeeId: string, index: number): PlanCell | undefined {
  if (!s.plan || s.plan.days[0]?.date !== s.startDate) return undefined
  return s.plan.rows.find((r) => r.employeeId === employeeId)?.cells[index]
}

export function plannerReducer(s: PlannerState, a: PlannerAction): PlannerState {
  switch (a.type) {
    case 'load': return fromDetail(a.detail, s.today)
    case 'name': return { ...s, name: a.name, nameTouched: true }
    case 'period': {
      if (a.startDate === s.startDate && a.endDate === s.endDate && a.periodType === s.periodType) return s
      const n = periodLength(a.startDate, a.endDate)
      return changed(s, {
        periodType: a.periodType, startDate: a.startDate, endDate: a.endDate,
        name: s.nameTouched ? s.name : defaultRosterName(a.startDate, a.endDate, a.scopeLabel),
        rows: realign(s.keepEdits ? s.rows : dropEdits(s.rows), s.startDate, a.startDate, n), undo: [],
      }, 'regenerate')
    }
    case 'scope': {
      if (a.departmentId === s.departmentId && a.branchId === s.branchId) return s
      return changed(s, {
        departmentId: a.departmentId, branchId: a.branchId,
        name: s.nameTouched ? s.name : defaultRosterName(s.startDate, s.endDate, a.scopeLabel),
      }, 'regenerate')
    }
    case 'shifts': return changed(s, { config: { ...s.config, shiftIds: a.shiftIds } }, 'refresh')
    case 'pattern':
      return changed(s, {
        config: { ...s.config, pattern: a.pattern, repeats: a.repeats, templateId: a.templateId },
        rows: s.keepEdits ? s.rows : dropEdits(s.rows),
      }, 'regenerate')
    case 'weeklyOffMode': return changed(s, { config: { ...s.config, weeklyOffMode: a.mode }, rows: s.keepEdits ? s.rows : dropEdits(s.rows) }, 'regenerate')
    case 'stagger': {
      // A different way of choosing start days chooses them again for everyone.
      const members = s.members.map((m) => ({ ...m, rotationOffset: null }))
      return changed(s, { config: { ...s.config, staggerMode: a.mode, continueFromRosterId: a.mode === 'CONTINUE' ? a.continueFromRosterId : null }, members }, 'regenerate')
    }
    case 'designations': return { ...s, config: { ...s.config, designationIds: a.designationIds } }
    case 'members': {
      const want = new Set(a.employeeIds)
      const kept = s.members.filter((m) => want.has(m.employeeId))
      const have = new Set(kept.map((m) => m.employeeId))
      const added = a.employeeIds.filter((id) => !have.has(id)).map((employeeId) => ({ employeeId, rotationOffset: null }))
      if (!added.length && kept.length === s.members.length) return s
      const rows: Record<string, DraftRow> = {}
      for (const m of kept) if (s.rows[m.employeeId]) rows[m.employeeId] = s.rows[m.employeeId]
      return changed(s, { members: [...kept, ...added], rows }, 'regenerate')
    }
    case 'required': {
      const rest = s.staffing.filter((x) => !(x.designationId === a.designationId && x.shiftPolicyId === a.shiftPolicyId))
      const staffing = a.required == null ? rest : [...rest, { designationId: a.designationId, shiftPolicyId: a.shiftPolicyId, required: a.required }]
      return changed(s, { staffing }, 'refresh')
    }
    case 'staffing': return changed(s, { staffing: a.staffing.map((x) => ({ ...x })) }, 'refresh')
    case 'generate': {
      const rows = s.keepEdits ? s.rows : dropEdits(s.rows)
      return { ...s, rows, generated: true, rev: s.rev + 1, pendingRegenerate: true }
    }
    case 'keepEdits': return { ...s, keepEdits: a.on }
    case 'resetEdits': return { ...s, rows: dropEdits(s.rows), generated: true, rev: s.rev + 1, pendingRegenerate: true, undo: [] }
    case 'cells': return editCells(s, a.edits)
    case 'offset': {
      if (!s.members.some((m) => m.employeeId === a.employeeId)) return s
      return changed(s, {
        members: s.members.map((m) => (m.employeeId === a.employeeId ? { ...m, rotationOffset: a.offset } : m)),
        rows: s.keepEdits ? s.rows : dropEdits(s.rows, a.employeeId),
      }, 'regenerate')
    }
    case 'removeMember': {
      if (!s.members.some((m) => m.employeeId === a.employeeId)) return s
      const rows = { ...s.rows }
      delete rows[a.employeeId]
      return changed(s, { members: s.members.filter((m) => m.employeeId !== a.employeeId), rows, undo: s.undo.filter((u) => !u.cells.some((c) => c.employeeId === a.employeeId)) }, 'refresh')
    }
    case 'undo': {
      const last = s.undo[s.undo.length - 1]
      if (!last) return s
      const rows = { ...s.rows }
      for (const c of last.cells) {
        const r = rows[c.employeeId]
        if (!r) continue
        const cells = [...r.cells]
        cells[c.index] = c.token
        const ed = new Set(r.edited)
        if (c.edited) ed.add(c.index); else ed.delete(c.index)
        rows[c.employeeId] = { cells, edited: [...ed].sort((x, y) => x - y) }
      }
      return changed(s, { rows, undo: s.undo.slice(0, -1) }, 'refresh')
    }
    case 'refresh': return s.generated ? { ...s, rev: s.rev + 1 } : s
    case 'plan': return adoptPlan(s, a)
    case 'baseline': return s.status === 'NEW' ? { ...s, savedSig: signature(s) } : s
    case 'reset': return initialState(s.today)
    case 'saved': {
      const r = a.detail.roster
      const next: PlannerState = {
        ...s, rosterId: r.id, lockVersion: r.lockVersion, status: r.status, version: r.version, hasUnpublishedChanges: r.hasUnpublishedChanges,
        savedSig: a.sentSig,
      }
      // The answer's plan is worked out on what was saved: show it only if nothing changed while saving.
      return a.sentRev === s.rev ? { ...next, plan: a.detail.plan ?? s.plan, planRev: s.rev } : next
    }
  }
}

function editCells(s: PlannerState, edits: readonly CellEdit[]): PlannerState {
  const open = firstOpenIndex(s)
  const n = periodLength(s.startDate, s.endDate)
  const rows = { ...s.rows }
  const undo: UndoCell[] = []
  for (const e of edits) {
    if (e.index < open || e.index >= n) continue
    // Before joining or after leaving a person can only be cleared (E4 otherwise).
    if (e.token != null && planCellAt(s, e.employeeId, e.index)?.outside) continue
    if (!s.members.some((m) => m.employeeId === e.employeeId)) continue
    const r = rows[e.employeeId] ?? { cells: Array.from({ length: n }, () => null), edited: [] }
    const was = r.cells[e.index] ?? null
    const wasEdited = r.edited.includes(e.index)
    if (was === e.token && wasEdited) continue
    undo.push({ employeeId: e.employeeId, index: e.index, token: was, edited: wasEdited })
    const cells = [...r.cells]
    cells[e.index] = e.token
    rows[e.employeeId] = { cells, edited: wasEdited ? r.edited : [...r.edited, e.index].sort((x, y) => x - y) }
  }
  if (!undo.length) return s
  return changed(s, { rows, undo: [...s.undo, { cells: undo }].slice(-UNDO_LIMIT) }, 'refresh')
}

/**
 * A preview answer. Its coverage and checks show at once. Its cells become the working copy only when it was a
 * regenerate asked for the current state (an answer overtaken by later edits is followed by a newer request).
 * A published roster keeps its days before today whatever the pattern now says.
 */
function adoptPlan(s: PlannerState, a: Extract<PlannerAction, { type: 'plan' }>): PlannerState {
  if (a.rev < s.planRev) return s
  const shown = { ...s, plan: a.plan, planRev: a.rev }
  if (!a.regenerate || a.rev !== s.rev || a.plan.days[0]?.date !== s.startDate) return shown
  const n = periodLength(s.startDate, s.endDate)
  const open = firstOpenIndex(s)
  const rows: Record<string, DraftRow> = {}
  let pastMoved = false
  for (const row of a.plan.rows) {
    const cells = fit(row.cells.map((c) => c.token), n)
    const edited = row.cells.flatMap((c, i) => (c.edited && i < n ? [i] : []))
    const prev = s.rows[row.employeeId]
    for (let i = 0; i < open; i++) {
      const was = prev?.cells[i] ?? null
      if (cells[i] !== was) { cells[i] = was; pastMoved = true }
    }
    rows[row.employeeId] = { cells, edited }
  }
  const offsets = new Map(a.plan.members.map((m) => [m.employeeId, m.rotationOffset]))
  const members = s.members.map((m) => ({ ...m, rotationOffset: offsets.get(m.employeeId) ?? m.rotationOffset }))
  for (const m of s.members) if (!rows[m.employeeId] && s.rows[m.employeeId]) rows[m.employeeId] = s.rows[m.employeeId]
  // Past days put back: the coverage shown was for the pattern's version, so ask once more.
  return { ...shown, rows, members, pendingRegenerate: false, undo: [], rev: pastMoved ? s.rev + 1 : s.rev }
}

// ── Wire bodies ─────────────────────────────────────────────────────────────────────────────────────

function wireRows(s: PlannerState): RowIn[] {
  const n = periodLength(s.startDate, s.endDate)
  return s.members.flatMap((m) => {
    const r = s.rows[m.employeeId]
    return r ? [{ employeeId: m.employeeId, cells: fit(r.cells, n), edited: r.edited.filter((i) => i < n) }] : []
  })
}

/**
 * Members as sent to the preview. No start day yet (new people, or after the way of choosing start days changed) goes
 * as a negative offset, -1: the engine (RosterPlanner) then spreads, keeps or continues it; any offset ≥ 0 is kept.
 */
export const NO_START_DAY = -1
const wireMembers = (s: PlannerState): MemberIn[] => s.members.map((m) => ({ employeeId: m.employeeId, rotationOffset: m.rotationOffset ?? NO_START_DAY }))

export function planRequest(s: PlannerState): PlanRequest {
  return {
    startDate: s.startDate, endDate: s.endDate, departmentId: s.departmentId, branchId: s.branchId, rosterId: s.rosterId,
    config: s.config, members: wireMembers(s), staffing: s.staffing, rows: wireRows(s),
    regenerate: s.pendingRegenerate,
    // "Keep my edits" off is applied when the change is made (the edited marks go then), so the request always keeps
    // what is still marked: an edit made while an answer is on its way is never lost.
    keepEdits: true,
  }
}

export function draftBody(s: PlannerState): DraftBody {
  return {
    name: s.name.trim() || defaultRosterName(s.startDate, s.endDate), periodType: s.periodType, startDate: s.startDate, endDate: s.endDate,
    departmentId: s.departmentId, branchId: s.branchId, config: s.config,
    members: s.members.map((m) => ({ employeeId: m.employeeId, rotationOffset: m.rotationOffset ?? 0 })),
    staffing: s.staffing, rows: wireRows(s), ...(s.rosterId && s.lockVersion != null ? { lockVersion: s.lockVersion } : {}),
  }
}

/** Why the draft can't be saved yet, or null. */
export function saveProblem(s: PlannerState): string | null {
  return rangeProblem(s.startDate, s.endDate) ?? (s.name.trim().length > 120 ? 'The name is longer than 120 characters.' : null)
}

// ── Grid view model ─────────────────────────────────────────────────────────────────────────────────

export interface GridDay { date: ISODate; dayNo: number; weekday: number; letter: string; holidayName: string | null; today: boolean; weekend: boolean }
export interface GridCell {
  token: CellToken
  code: string | null
  /** Colour slot: a shift's tone, 'wo', or '' for an empty cell. */
  tone: string
  edited: boolean
  overlay: PlanCell['overlay']
  outside: boolean
  /** The worst issue on the cell. */
  level: 'error' | 'warning' | null
  issueKeys: string[]
  /** A published roster's day before today. */
  locked: boolean
}
export interface GridRow {
  employeeId: string
  name: string
  code: string | null
  designationId: string | null
  designationName: string | null
  offset: number | null
  cells: GridCell[]
  totals: PlanRow['totals'] | null
}
export interface GridView { days: GridDay[]; rows: GridRow[] }

/** The issue level per issue key, errors first. */
export function issueLevels(checks: Checks | null | undefined): Map<string, Issue['level']> {
  const m = new Map<string, Issue['level']>()
  for (const i of [...(checks?.infos ?? []), ...(checks?.warnings ?? []), ...(checks?.errors ?? [])]) m.set(i.key, i.level)
  return m
}

/**
 * The grid as shown: the working copy's tokens (so a hand edit paints at once), with the last answer's overlays,
 * outside marks, issues and totals laid on top when the answer is for this period. Rows follow the member order;
 * a person the answer doesn't know yet shows with what the people list says.
 */
export function gridView(s: PlannerState, shifts: ReadonlyMap<string, ShiftLite>, people: ReadonlyMap<string, PlannerPerson>, filterDesignation?: string | null): GridView {
  const dates = periodDates(s.startDate, s.endDate)
  const samePeriod = s.plan?.days[0]?.date === s.startDate && s.plan?.days.length === dates.length
  const planDays = samePeriod ? s.plan!.days : null
  const days: GridDay[] = dates.map((date, i) => {
    const wd = planDays?.[i]?.weekday ?? isoWeekday(date)
    return { date, dayNo: Number(date.slice(8, 10)), weekday: wd, letter: WEEKDAY_LETTER[wd - 1], holidayName: planDays?.[i]?.holidayName ?? null, today: date === s.today, weekend: wd >= 6 }
  })
  const planRows = new Map((samePeriod ? s.plan!.rows : []).map((r) => [r.employeeId, r]))
  const levels = issueLevels(samePeriod ? s.plan!.checks : null)
  const open = firstOpenIndex(s)
  const rows: GridRow[] = []
  for (const m of s.members) {
    const pr = planRows.get(m.employeeId)
    const person = people.get(m.employeeId)
    const designationId = pr?.designationId ?? person?.designationId ?? null
    if (filterDesignation != null && (designationId ?? '') !== filterDesignation) continue
    const draft = s.rows[m.employeeId]
    const edited = new Set(draft?.edited ?? [])
    rows.push({
      employeeId: m.employeeId,
      name: pr?.employeeName ?? person?.name ?? 'Unknown person',
      code: pr?.employeeCode ?? person?.code ?? null,
      designationId,
      designationName: pr?.designationName ?? person?.designationName ?? null,
      offset: m.rotationOffset,
      totals: pr?.totals ?? null,
      cells: dates.map((_, i) => {
        const token = draft?.cells[i] ?? null
        const pc = pr?.cells[i]
        const keys = pc?.issueIds ?? []
        let level: GridCell['level'] = null
        for (const k of keys) { const l = levels.get(k); if (l === 'error') { level = 'error'; break } if (l === 'warning') level = 'warning' }
        return {
          token, code: tokenCode(token, shifts, pc?.code), tone: token == null ? '' : token === WO_TOKEN ? 'wo' : shifts.get(token)?.tone ?? '1',
          edited: edited.has(i), overlay: pc?.overlay ?? null, outside: !!pc?.outside, level, issueKeys: keys, locked: i < open,
        }
      }),
    })
  }
  return { days, rows }
}

// ── Coverage ────────────────────────────────────────────────────────────────────────────────────────

export interface CoverageCellView { label: string; tone: 'ok' | 'short' | 'over' | 'none' | 'holiday'; title: string }
export interface CoverageLine { key: string; shiftPolicyId: string; designationId: string | null; label: string; cells: CoverageCellView[]; short: number }

const COV_TONE = { OK: 'ok', SHORT: 'short', OVER: 'over', NONE: 'none', HOLIDAY: 'holiday' } as const
export function coverageCell(d: { required: number | null; scheduled: number; status: keyof typeof COV_TONE }): CoverageCellView {
  const tone = COV_TONE[d.status] ?? 'none'
  if (d.status === 'HOLIDAY') return { label: '–', tone, title: 'Holiday: coverage isn’t checked' }
  if (d.required == null || d.status === 'NONE') return { label: '', tone: 'none', title: `${d.scheduled} planned, no requirement` }
  const title = d.status === 'SHORT' ? `${d.scheduled} of ${d.required} needed` : d.status === 'OVER' ? `${d.scheduled} planned, ${d.required} needed` : `${d.scheduled} of ${d.required}`
  return { label: `${d.scheduled}/${d.required}`, tone, title }
}

/**
 * Coverage rows under the grid: one per shift (all designations), and its designation rows. Shifts follow the
 * ticked order; designation names come from the people list.
 */
export function coverageView(plan: PlanResponse | null, shiftIds: readonly string[], shifts: ReadonlyMap<string, ShiftLite>, designationNames: ReadonlyMap<string, string>): { line: CoverageLine; parts: CoverageLine[] }[] {
  if (!plan) return []
  const order = new Map(shiftIds.map((id, i) => [id, i]))
  const byShift = new Map<string, { line?: CoverageLine; parts: CoverageLine[] }>()
  for (const c of plan.coverage) {
    // A holiday column is never a gap, whatever the day reports (the requirement still comes back on it).
    const cells = c.perDay.map((d, i) => coverageCell(plan.days[i]?.holidayName ? { ...d, status: 'HOLIDAY' } : d))
    const sh = shifts.get(c.shiftPolicyId)
    const code = c.code ?? sh?.code ?? '?'
    const line: CoverageLine = {
      key: `${c.shiftPolicyId}|${c.designationId ?? ''}`, shiftPolicyId: c.shiftPolicyId, designationId: c.designationId,
      label: c.designationId == null ? `${code}${sh ? ` · ${sh.name}` : ''}` : designationNames.get(c.designationId) ?? 'Designation',
      cells, short: cells.filter((x) => x.tone === 'short').length,
    }
    const g = byShift.get(c.shiftPolicyId) ?? { parts: [] }
    if (c.designationId == null) g.line = line; else g.parts.push(line)
    byShift.set(c.shiftPolicyId, g)
  }
  return [...byShift.entries()]
    .filter(([, g]) => g.line)
    .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    .map(([, g]) => ({ line: g.line!, parts: g.parts.sort((x, y) => x.label.localeCompare(y.label)) }))
}

// ── Checks ──────────────────────────────────────────────────────────────────────────────────────────

export const allIssues = (c: Checks | null | undefined): Issue[] => [...(c?.errors ?? []), ...(c?.warnings ?? []), ...(c?.infos ?? [])]
export const issuesOf = (c: Checks | null | undefined, id: Issue['id']) => allIssues(c).filter((i) => i.id === id)
/** "2 errors · 5 warnings", "1 warning", "No issues". */
export function checkCountLabel(c: Checks | null | undefined) {
  const e = c?.errors.length ?? 0, w = c?.warnings.length ?? 0
  const parts = [e ? `${e} ${e === 1 ? 'error' : 'errors'}` : '', w ? `${w} ${w === 1 ? 'warning' : 'warnings'}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'No issues'
}
/** The summary's label without a leading tick or warning sign (the panel draws its own). */
export const summaryText = (label: string) => label.replace(/^[\s✓✔⚠✕✗×!]+/u, '').trim()

// ── People ──────────────────────────────────────────────────────────────────────────────────────────

export const NO_DESIGNATION = ''
export interface PeopleGroup { designationId: string; name: string; people: PlannerPerson[] }
/** People by designation, by name; "No designation" last (pending-owner default 8). */
export function groupPeople(people: readonly PlannerPerson[]): PeopleGroup[] {
  const m = new Map<string, PeopleGroup>()
  for (const p of people) {
    const id = p.designationId ?? NO_DESIGNATION
    const g = m.get(id) ?? { designationId: id, name: p.designationName || (id ? 'Designation' : 'No designation'), people: [] }
    g.people.push(p)
    m.set(id, g)
  }
  for (const g of m.values()) g.people.sort((a, b) => a.name.localeCompare(b.name))
  return [...m.values()].sort((a, b) => (a.designationId === NO_DESIGNATION ? 1 : 0) - (b.designationId === NO_DESIGNATION ? 1 : 0) || a.name.localeCompare(b.name))
}
/** A person's other rosters in the period, leaving out the roster being edited. */
export const otherRostersOf = (p: PlannerPerson, rosterId: string | null) => p.otherRosters.filter((o) => o.rosterId !== rosterId)

/** Published rosters of the same scope that end the day before this one starts ("Continue from …"). */
export function continueCandidates(rosters: readonly RosterSummary[], s: Pick<PlannerState, 'rosterId' | 'departmentId' | 'branchId' | 'startDate'>) {
  const dayBefore = addDaysIso(s.startDate, -1)
  return rosters.filter((r) => r.id !== s.rosterId && r.status === 'PUBLISHED' && r.endDate === dayBefore
    && (r.departmentId ?? null) === s.departmentId && (r.branchId ?? null) === s.branchId)
}
/** The latest roster of the same scope that ends before this one starts ("Copy from …" in Staffing). */
export function previousRoster(rosters: readonly RosterSummary[], s: Pick<PlannerState, 'rosterId' | 'departmentId' | 'branchId' | 'startDate'>) {
  return rosters
    .filter((r) => r.id !== s.rosterId && r.endDate < s.startDate && (r.departmentId ?? null) === s.departmentId && (r.branchId ?? null) === s.branchId)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0] ?? null
}

// ── Publish ─────────────────────────────────────────────────────────────────────────────────────────

/** What a publish writes: the planned days from today on (design §1.5 step 3), and the people who have one. */
export function publishReach(s: PlannerState) {
  const from = Math.max(0, daysBetween(s.startDate, s.today))
  let days = 0, people = 0
  for (const m of s.members) {
    const r = s.rows[m.employeeId]
    const n = r ? r.cells.slice(from).filter((c) => c != null).length : 0
    days += n
    if (n) people++
  }
  return { from: from > 0 ? s.today : s.startDate, days, people, past: s.endDate < s.today }
}
export type PublishReach = ReturnType<typeof publishReach>

/** "Saved just now", "Saved 2 min ago", "Saved at 14:05". */
export function savedLabel(at: number | null, now: number) {
  if (at == null) return ''
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'Saved just now'
  if (min < 60) return `Saved ${min} min ago`
  const d = new Date(at)
  return `Saved at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
