// The roster import page's pure model (design §1.7 "Web"): the four steps Import → Validate → Preview → Apply and
// when each can open, the period helpers, the problems filter, and the preview table. No planning rule lives here:
// the server reads the file, matches people, checks every cell and runs the planner (POST /v1/rosters/import/validate).
import type { ImportValidation, PlanResponse, RosterSummary } from '../../../api/rosterTypes'

export type ImportStep = 'import' | 'validate' | 'preview' | 'apply'
export const IMPORT_STEPS: readonly { key: ImportStep; label: string }[] = [
  { key: 'import', label: 'Import' },
  { key: 'validate', label: 'Validate' },
  { key: 'preview', label: 'Preview' },
  { key: 'apply', label: 'Apply' },
]

/** The server's limits (RosterSheetLayout): 2 MB, 2,000 rows, .xlsx or .csv. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_ROWS = 2000
export const ACCEPT = '.xlsx,.csv'
export const MAX_DAYS = 62
export const NAME_MAX = 120

export type Target = 'new' | 'replace'

/** What the page holds between steps. */
export interface ImportState {
  periodType: 'MONTH' | 'RANGE'
  startDate: string
  endDate: string
  departmentId: string | null
  branchId: string | null
  target: Target
  /** The draft whose days the file replaces (target 'replace'). */
  draft: Pick<RosterSummary, 'id' | 'name' | 'startDate' | 'endDate' | 'departmentId' | 'branchId'> | null
  fileName: string | null
  validation: ImportValidation | null
}

// ── period ──────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** The first and last day of a month ('2027-01' → 2027-01-01 … 2027-01-31). */
export function monthPeriod(ym: string): { startDate: string; endDate: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(last)}` }
}

/** The month after the one a date is in ('2026-10-10' → '2026-11'): the usual month to import. */
export function nextMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}

/** Days from start to end, both included. */
export function periodLength(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
}

/** Why a period can't be imported, or null (the server's rule: at most 62 days, the end not before the start). */
export function rangeProblem(start: string, end: string): string | null {
  if (!start || !end) return 'Pick the first and last day.'
  if (end < start) return 'The last day is before the first day.'
  if (periodLength(start, end) > MAX_DAYS) return `A roster covers at most ${MAX_DAYS} days.`
  return null
}

const dShort = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}` }

/** "January 2027" for a whole month, else "1 – 14 Oct 2026" / "28 Sep – 11 Oct 2026". */
export function periodLabel(start: string, end: string): string {
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2] = end.split('-').map(Number)
  if (d1 === 1 && monthPeriod(start.slice(0, 7)).endDate === end) return `${MONTHS[m1 - 1]} ${y1}`
  if (y1 === y2 && m1 === m2) return `${d1} – ${dShort(end)} ${y2}`
  return y1 === y2 ? `${dShort(start)} – ${dShort(end)} ${y2}` : `${dShort(start)} ${y1} – ${dShort(end)} ${y2}`
}

/** A whole month or a range, from two dates. */
export function periodTypeOf(start: string, end: string): 'MONTH' | 'RANGE' {
  return start.endsWith('-01') && monthPeriod(start.slice(0, 7)).endDate === end ? 'MONTH' : 'RANGE'
}

/** The name a new imported roster starts with ("January 2027 · Technical"), the store's own default. */
export function defaultName(start: string, end: string, scope?: string | null): string {
  const base = periodLabel(start, end)
  return (scope ? `${base} · ${scope}` : base).slice(0, NAME_MAX)
}

export function initialState(today: string): ImportState {
  const m = monthPeriod(nextMonth(today))
  return { periodType: 'MONTH', ...m, departmentId: null, branchId: null, target: 'new', draft: null, fileName: null, validation: null }
}

// ── scope ───────────────────────────────────────────────────────────────────

/** The departments a planner may import into: all active ones (HR), or the active ones they head. */
export function plannableDepartments<D extends { id: string; name: string; active?: boolean; departmentHeadEmployeeId?: string }>(
  departments: readonly D[], companyWide: boolean, myEmployeeId: string | null | undefined,
): D[] {
  const active = departments.filter((d) => d.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  if (companyWide) return active
  return myEmployeeId ? active.filter((d) => d.departmentHeadEmployeeId === myEmployeeId) : []
}

/** Drafts an import may replace: never published (version 0), newest period first. */
export function replaceableDrafts<R extends Pick<RosterSummary, 'status' | 'version' | 'startDate'>>(rosters: readonly R[]): R[] {
  return rosters.filter((r) => r.status === 'DRAFT' && r.version === 0).sort((a, b) => b.startDate.localeCompare(a.startDate))
}

/** Choosing a draft to replace takes its period, department and building (the server refuses any other). */
export function withDraft(s: ImportState, draft: ImportState['draft']): ImportState {
  if (!draft) return { ...s, draft: null, validation: null }
  return {
    ...s, draft, target: 'replace', startDate: draft.startDate, endDate: draft.endDate,
    periodType: periodTypeOf(draft.startDate, draft.endDate), departmentId: draft.departmentId, branchId: draft.branchId, validation: null,
  }
}

/**
 * What a change on step 1 does to the page: the period, scope, target or file changes what the file means, so the
 * last check no longer holds and the later steps close until the file is checked again.
 */
export function changeScope(s: ImportState, patch: Partial<Pick<ImportState, 'periodType' | 'startDate' | 'endDate' | 'departmentId' | 'branchId' | 'target' | 'fileName'>>): ImportState {
  const next = { ...s, ...patch, validation: null }
  if (patch.target === 'new') next.draft = null
  return next
}

// ── step gating ─────────────────────────────────────────────────────────────

/** Why the file can't be checked yet, or null. */
export function validateBlocker(s: ImportState, opts: { hasFile: boolean; companyId: string; companyWide: boolean }): string | null {
  if (!opts.companyId) return 'Choose the company first.'
  const range = rangeProblem(s.startDate, s.endDate)
  if (range) return range
  if (!opts.companyWide && !s.departmentId) return 'Choose one of the departments you head.'
  if (s.target === 'replace' && !s.draft) return 'Choose the draft whose days the file replaces.'
  if (!opts.hasFile) return 'Choose the roster file.'
  return null
}

/** The furthest step the page may open with what it has. */
export function furthestStep(s: ImportState): ImportStep {
  const v = s.validation
  if (!v) return 'import'
  if (v.summary.errors > 0 || !v.plan || v.summary.matched === 0) return 'validate'
  return 'apply'
}

const ORDER: ImportStep[] = ['import', 'validate', 'preview', 'apply']

export function canOpen(step: ImportStep, s: ImportState): boolean {
  return ORDER.indexOf(step) <= ORDER.indexOf(furthestStep(s))
}

/** The step track's states: done before the current one, todo after it. */
export function stepStates(current: ImportStep): { key: ImportStep; label: string; state: 'done' | 'current' | 'todo' }[] {
  const at = ORDER.indexOf(current)
  return IMPORT_STEPS.map((st, i) => ({ ...st, state: i < at ? 'done' : i === at ? 'current' : 'todo' }))
}

// ── problems ────────────────────────────────────────────────────────────────

export type ImportProblem = ImportValidation['problems'][number]
export type ProblemFilter = 'all' | 'error' | 'warning' | 'info'

export function problemCounts(problems: readonly ImportProblem[]): Record<ProblemFilter, number> {
  const c = { all: problems.length, error: 0, warning: 0, info: 0 }
  for (const p of problems) c[p.severity]++
  return c
}

export function filterProblems(problems: readonly ImportProblem[], filter: ProblemFilter): ImportProblem[] {
  return filter === 'all' ? [...problems] : problems.filter((p) => p.severity === filter)
}

/** Where in the file a problem is: "Column M · 12 Jan", "12 Jan", "Column B", or "" for the whole file. */
export function problemWhere(p: Pick<ImportProblem, 'column' | 'date'>): string {
  const parts: string[] = []
  if (p.column) parts.push(`Column ${p.column}`)
  if (p.date) parts.push(dShort(p.date))
  return parts.join(' · ')
}

export const SEVERITY_LABEL: Record<ImportProblem['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Note' }

// ── preview ─────────────────────────────────────────────────────────────────

export interface PreviewCell { code: string | null; overlay: 'PH' | 'L' | 'COFF' | null; outside: boolean; flagged: 'error' | 'warning' | null }
export interface PreviewRow {
  employeeId: string; name: string; code: string | null; designation: string | null
  cells: PreviewCell[]; working: number; weeklyOff: number; holiday: number; leave: number
}
export interface PreviewDay { date: string; day: number; weekday: string; holiday: string | null }

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** The planner's answer as a plain table: one row per person, a code (or the holiday / leave on top) per day. */
export function previewTable(plan: PlanResponse): { days: PreviewDay[]; rows: PreviewRow[] } {
  const levels = new Map<string, 'error' | 'warning'>()
  for (const i of plan.checks.errors) levels.set(i.key, 'error')
  for (const i of plan.checks.warnings) if (!levels.has(i.key)) levels.set(i.key, 'warning')
  const days = plan.days.map((d) => ({ date: d.date, day: Number(d.date.slice(8, 10)), weekday: WEEKDAY[(d.weekday - 1 + 7) % 7], holiday: d.holidayName }))
  const rows = plan.rows.map((r) => ({
    employeeId: r.employeeId, name: r.employeeName, code: r.employeeCode, designation: r.designationName,
    cells: r.cells.map((c) => {
      const marks = c.issueIds.map((k) => levels.get(k)).filter(Boolean)
      return {
        code: c.code, overlay: c.overlay?.type ?? null, outside: c.outside,
        flagged: marks.includes('error') ? 'error' as const : marks.includes('warning') ? 'warning' as const : null,
      }
    }),
    working: r.totals.working, weeklyOff: r.totals.weeklyOff, holiday: r.totals.holiday, leave: r.totals.leave,
  }))
  return { days, rows }
}

/** The "Schedule check" lines: what is fine and what needs a look (errors first). */
export function checkLines(plan: PlanResponse): { label: string; level: 'error' | 'warning' | 'info'; count: number }[] {
  const rank = { error: 0, warning: 1, info: 2 }
  return [...plan.checks.summary].sort((a, b) => rank[a.level] - rank[b.level]).map((l) => ({ label: l.label, level: l.level, count: l.count }))
}

/** What Apply will do, in a sentence. */
export function applySummary(s: ImportState): string {
  const v = s.validation
  const n = v?.summary.matched ?? 0
  const people = `${n} ${n === 1 ? 'person' : 'people'}`
  if (s.target === 'replace' && s.draft) return `The people and days of the draft “${s.draft.name}” are replaced by the file’s ${people}.`
  return `A new draft roster for ${periodLabel(s.startDate, s.endDate)} is created with ${people}.`
}

/** The answer of a failed apply, in plain words (the server's message for the codes it explains itself). */
export function applyError(code: string | undefined, message: string | undefined): string {
  if (code === 'ROSTER_CHANGED') return 'Someone else saved this draft. Reload it in the planner, then import again.'
  if (code === 'ROSTER_PUBLISHED') return 'That roster has been published, so an import can’t replace its days. Import into a new draft instead.'
  return message || 'The draft couldn’t be saved. Try again.'
}
