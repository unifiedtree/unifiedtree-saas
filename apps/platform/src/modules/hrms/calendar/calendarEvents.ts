// The rules behind the Keka-style month calendar (EventsCalendar.tsx): which things land on which
// day — company holidays, approved leave (sick leave told apart from the rest), birthdays and work
// anniversaries — how the chips filter them, and how the agenda groups them. Pure, so it is
// unit-tested without a server. Every date is a plain calendar day ("2026-10-06").
import { shiftDay, spanDays } from '@/design/kit/dateRangeModel'

export type EventKind = 'holiday' | 'leave' | 'sick' | 'birthday' | 'anniversary'

export interface CalEvent {
  /** Unique per event and day. */
  key: string
  /** The thing it belongs to (a leave request, a holiday, a person): counts are of these, not of days. */
  ref: string
  kind: EventKind
  /** yyyy-MM-dd */
  date: string
  /** "Asha Verma", "Diwali". */
  title: string
  /** "Sick leave · 6 – 8 Oct", "Birthday", "3 years at work". */
  detail: string
  leaveTypeId?: string
  leaveTypeName?: string
  /** Birthdays and anniversaries: whose. */
  employeeId?: string
}

/** What the calendar draws, most important first (a day shows its first few). */
export const KIND_ORDER: readonly EventKind[] = ['holiday', 'sick', 'leave', 'birthday', 'anniversary']

export const KIND_LABEL: Record<EventKind, string> = {
  holiday: 'Holiday', leave: 'Leave', sick: 'Sick leave', birthday: 'Birthday', anniversary: 'Work anniversary',
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`

/** "6 Oct", "6 – 8 Oct", "30 Sep – 2 Oct". */
export function spanText(from: string, to: string): string {
  if (from === to) return dm(from)
  return from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))} – ${dm(to)}` : `${dm(from)} – ${dm(to)}`
}

/**
 * Whether a leave type is sick leave: its category is SICK (the Leave types page sets it), or, for
 * types made before categories, its code or name says so.
 */
export function isSickLeave(t: { leaveTypeCategory?: string | null; leaveTypeCode?: string | null; leaveTypeName?: string | null }): boolean {
  if (t.leaveTypeCategory) return t.leaveTypeCategory.toUpperCase() === 'SICK'
  const code = (t.leaveTypeCode ?? '').toUpperCase()
  return code === 'SL' || code === 'SICK' || /\bsick\b/i.test(t.leaveTypeName ?? '')
}

/** Every day from `from` to `to` that also lies inside [lo, hi]. */
function daysWithin(from: string, to: string, lo: string, hi: string): string[] {
  const a = from < lo ? lo : from, b = to > hi ? hi : to
  const out: string[] = []
  if (a > b) return out
  for (let d = a, guard = 0; d <= b && guard < 400; d = shiftDay(d, 1), guard++) out.push(d)
  return out
}

export interface LeaveLike {
  id: string
  employeeName?: string | null
  firstName?: string | null
  leaveTypeId: string
  leaveTypeName?: string | null
  leaveTypeCode?: string | null
  leaveTypeCategory?: string | null
  startDate: string
  endDate: string
  status: string
}

/** Approved leave as one event per day inside [lo, hi]; sick leave gets its own kind. */
export function leaveEvents(entries: readonly LeaveLike[], lo: string, hi: string): CalEvent[] {
  const seen = new Set<string>()
  const out: CalEvent[] = []
  for (const e of entries) {
    if (e.status !== 'APPROVED' || seen.has(e.id)) continue
    seen.add(e.id)
    const from = e.startDate.slice(0, 10), to = e.endDate.slice(0, 10)
    const kind: EventKind = isSickLeave(e) ? 'sick' : 'leave'
    const type = e.leaveTypeName || (kind === 'sick' ? 'Sick leave' : 'Leave')
    const name = e.employeeName || e.firstName || 'Someone'
    for (const d of daysWithin(from, to, lo, hi)) {
      out.push({
        key: `l-${e.id}-${d}`, ref: `l-${e.id}`, kind, date: d, title: name,
        detail: `${type} · ${spanText(from, to)}${spanDays(from, to) > 1 ? ` · ${spanDays(from, to)} days` : ''}`,
        leaveTypeId: e.leaveTypeId, leaveTypeName: type,
      })
    }
  }
  return out
}

export function holidayEvents(list: readonly { id?: string; holidayDate: string; holidayName: string; active?: boolean }[], lo: string, hi: string): CalEvent[] {
  const out: CalEvent[] = []
  for (const h of list) {
    if (h.active === false || !h.holidayDate) continue
    const d = h.holidayDate.slice(0, 10)
    if (d < lo || d > hi) continue
    out.push({ key: `h-${h.id ?? h.holidayName}-${d}`, ref: `h-${h.id ?? h.holidayName}-${d}`, kind: 'holiday', date: d, title: h.holidayName, detail: 'Company holiday' })
  }
  return out
}

export function milestoneEvents(kind: 'birthday' | 'anniversary', list: readonly { employeeId: string; name: string; date: string; years?: number | null }[], lo: string, hi: string): CalEvent[] {
  const out: CalEvent[] = []
  for (const m of list) {
    const d = m.date?.slice(0, 10)
    if (!d || d < lo || d > hi) continue
    const detail = kind === 'birthday' ? 'Birthday'
      : m.years ? `${m.years} ${m.years === 1 ? 'year' : 'years'} at work` : 'Work anniversary'
    out.push({ key: `${kind[0]}-${m.employeeId}-${d}`, ref: `${kind[0]}-${m.employeeId}-${d}`, kind, date: d, title: m.name, detail, employeeId: m.employeeId })
  }
  return out
}

const rank = (k: EventKind) => KIND_ORDER.indexOf(k)
export function sortEvents(list: readonly CalEvent[]): CalEvent[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title))
}

// ── filters ─────────────────────────────────────────────────────────────────

/** Birthdays and anniversaries of these people only (a team calendar); null keeps everyone. */
export function onlyPeople(list: readonly CalEvent[], people: ReadonlySet<string> | null | undefined): CalEvent[] {
  if (!people) return [...list]
  return list.filter((e) => (e.kind !== 'birthday' && e.kind !== 'anniversary') || (!!e.employeeId && people.has(e.employeeId)))
}

/** The chips: everything, or one kind ("Leave" is every leave type, sick included). */
export type CalFilter = 'all' | 'holiday' | 'leave' | 'sick' | 'birthday' | 'anniversary'

/** The chip, then the leave-type pick (which narrows only the leave; holidays and people stay). */
export function applyFilter(list: readonly CalEvent[], filter: CalFilter, leaveTypeId: string | null): CalEvent[] {
  return list.filter((e) => {
    const isLeave = e.kind === 'leave' || e.kind === 'sick'
    if (filter === 'leave' && !isLeave) return false
    if (filter !== 'all' && filter !== 'leave' && e.kind !== filter) return false
    if (leaveTypeId && isLeave && e.leaveTypeId !== leaveTypeId) return false
    return true
  })
}

/** How many things (not days) of each chip are in the list. */
export function filterCounts(list: readonly CalEvent[]): Record<CalFilter, number> {
  const refs: Record<CalFilter, Set<string>> = { all: new Set(), holiday: new Set(), leave: new Set(), sick: new Set(), birthday: new Set(), anniversary: new Set() }
  for (const e of list) {
    refs.all.add(e.ref)
    refs[e.kind].add(e.ref)
    if (e.kind === 'sick') refs.leave.add(e.ref)
  }
  return Object.fromEntries(Object.entries(refs).map(([k, s]) => [k, s.size])) as Record<CalFilter, number>
}

/** The leave types in the list, by name, with how many requests of each. */
export function leaveTypesIn(list: readonly CalEvent[]): { id: string; name: string; sick: boolean; count: number }[] {
  const m = new Map<string, { id: string; name: string; sick: boolean; refs: Set<string> }>()
  for (const e of list) {
    if (!e.leaveTypeId) continue
    const t = m.get(e.leaveTypeId) ?? { id: e.leaveTypeId, name: e.leaveTypeName || 'Leave', sick: e.kind === 'sick', refs: new Set<string>() }
    t.refs.add(e.ref)
    m.set(e.leaveTypeId, t)
  }
  return [...m.values()].map(({ refs, ...t }) => ({ ...t, count: refs.size })).sort((a, b) => a.name.localeCompare(b.name))
}

// ── grouping ────────────────────────────────────────────────────────────────

export function byDay(list: readonly CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>()
  for (const e of sortEvents(list)) m.set(e.date, [...(m.get(e.date) ?? []), e])
  return m
}

/** The agenda: the days of [from, to] that have something, in order. */
export function agenda(list: readonly CalEvent[], from: string, to: string): { date: string; events: CalEvent[] }[] {
  const m = byDay(list.filter((e) => e.date >= from && e.date <= to))
  return [...m.keys()].sort().map((date) => ({ date, events: m.get(date)! }))
}

/** The first and last day of a month ('yyyy-MM'). */
export function monthSpan(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: `${ym}-01`, to: shiftDay(`${next}-01`, -1) }
}

/** The leave feed answers at most 62 days: the part of a range it can show. */
export const LEAVE_FEED_MAX_DAYS = 62
export function leaveWindow(from: string, to: string): { from: string; to: string; clipped: boolean } {
  if (spanDays(from, to) <= LEAVE_FEED_MAX_DAYS) return { from, to, clipped: false }
  return { from, to: shiftDay(from, LEAVE_FEED_MAX_DAYS - 1), clipped: true }
}
