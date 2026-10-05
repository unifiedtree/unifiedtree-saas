// The Workforce directory's rules, kept apart from React so they are tested on their own
// (directoryModel.test.ts). Every rule is the one the Master design's Employee Master used
// (src/design/master/MasterDesign.tsx EmployeesPage / EmpForm / EmpProfile), so the kit page
// filters, sorts, changes status and starts exits exactly as before.
import type { StatusTone } from '@/design/kit/display'
import type { Rec } from '../master/masterData'

/** The statuses the directory always offers, in this order (others found on records follow). */
export const BASE_STATUSES = ['Active', 'Probation', 'On notice', 'Exited', 'Suspended'] as const
/** The employment types the Type filter always offers. */
export const BASE_TYPES = ['Full-time', 'Part-time', 'Intern'] as const

export const STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success', Probation: 'amber', 'On notice': 'leave', Exited: 'neutral', Suspended: 'danger', Inactive: 'neutral',
}
export const statusTone = (s: string): StatusTone => STATUS_TONE[s] || 'neutral'

/** The directory's filters: status, department (with its sub-departments; '__none' = no department), branch, type, words, milestone. */
export interface DirectoryFilter {
  status: string
  dept: string
  branch: string
  type: string
  q: string
  /** null: no milestone chosen. A Set: only these people (the server picked them). Undefined ids while loading: nobody. */
  milestone: { on: boolean; ids: ReadonlySet<string> | null }
}

export interface Lookups {
  /** Department records (id, parent). */
  depts: Rec[]
  /** A designation's name, '—' when there is none. */
  desigName: (id: string) => string
  /** A department's name, '—' when there is none. */
  deptName: (id: string) => string
}

/** The departments a department filter covers: itself and its direct sub-departments. */
export function deptScope(dept: string, depts: Rec[]): string[] | null {
  if (!dept) return null
  return [dept].concat(depts.filter((x) => x.parent === dept).map((x) => x.id as string))
}

export function filterEmployees(list: Rec[], f: DirectoryFilter, look: Lookups): Rec[] {
  const ids = deptScope(f.dept, look.depts)
  const ql = f.q.trim().toLowerCase()
  return list.filter((e) =>
    (!f.status || e.status === f.status)
    && (!ids || (f.dept === '__none' ? !e.dept : ids.includes(e.dept)))
    && (!f.milestone.on || !!(f.milestone.ids && f.milestone.ids.has(e.id)))
    && (!f.branch || e.branch === f.branch)
    && (!f.type || e.type === f.type)
    && (!ql || `${e.name} ${e.code} ${e.email || ''} ${look.desigName(e.desig)}`.toLowerCase().includes(ql)))
}

export type SortKey = 'name' | 'code' | 'desig' | 'joined'
export interface Sort { k: SortKey; d: 1 | -1 }

/**
 * Sorted as the design's table sorted: by name, code or joining date. The Designation column
 * sorts by department and then designation, so "sort by department" is still there.
 */
export function sortEmployees(rows: Rec[], sort: Sort, look: Lookups): Rec[] {
  const get = (e: Rec): string => sort.k === 'name' ? e.name
    : sort.k === 'joined' ? e.joined || ''
      : sort.k === 'desig' ? `${look.deptName(e.dept)}\u0000${look.desigName(e.desig)}`
        : e.code
  return rows.slice().sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.d })
}

/** Status options: the base list plus any other status found on a record, each with its count. */
export function statusOptions(list: Rec[]): { value: string; count: number }[] {
  const all = Array.from(new Set<string>([...BASE_STATUSES, ...list.map((e) => e.status as string)]))
  return all.map((s) => ({ value: s, count: list.filter((e) => e.status === s).length }))
}

export function typeOptions(list: Rec[]): string[] {
  return Array.from(new Set<string>([...BASE_TYPES, ...list.map((e) => e.type as string)]))
}

/** The department filter's options: top-level departments, each followed by its sub-departments. */
export function deptOptions(depts: Rec[]): { value: string; label: string; sub?: string }[] {
  return depts.filter((x) => !x.parent).flatMap((p) => [{ value: p.id as string, label: p.name as string }]
    .concat(depts.filter((c) => c.parent === p.id).map((c) => ({ value: c.id as string, label: c.name as string, sub: `in ${p.name}` }))))
}

/**
 * "Change status" for the selected people: who actually changes. Exited people never do, nor
 * anyone already in that status, nor someone serving notice going back to probation.
 */
export function bulkStatusTargets(list: Rec[], selected: ReadonlySet<string>, to: 'Active' | 'Probation'): Rec[] {
  return list.filter((e) => selected.has(e.id) && e.status !== 'Exited' && e.status !== to && !(to === 'Probation' && e.status === 'On notice'))
}

/** Start exit: a last working day today or earlier exits now; a later one starts the notice period. */
export function exitChange(lwd: string, todayIso: string): { status: 'Exited'; exitOn: string } | { status: 'On notice'; lwd: string } {
  return lwd <= todayIso ? { status: 'Exited', exitOn: lwd } : { status: 'On notice', lwd }
}

/** The last working day Start exit suggests: today plus the full-time notice period (60 days without one). */
export function suggestedLastDay(classes: Rec[], todayIso: string): string {
  const ft = (classes.find((c) => c.code === 'FULL_TIME') || classes[0] || {}) as Rec
  const days = Number(ft.notice) || 60
  return new Date(new Date(todayIso + 'T12:00:00Z').getTime() + days * 864e5).toISOString().slice(0, 10)
}

/** Leaving or left: no Start exit for them. */
export const isLeaving = (e: Rec) => e.status === 'Exited' || e.status === 'On notice'

const asDate = (s: string) => new Date(String(s).length === 10 ? `${s}T12:00:00` : s)
/** "12 Mar 2022"; "—" when empty. */
export const fmtDate = (s?: string | null) => (s ? asDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
/** "2 yr 3 mo", "5 mo", "Joined this month"; "—" when empty. */
export function tenure(s: string | null | undefined, today: Date): string {
  if (!s) return '—'
  const m = Math.floor((today.getTime() - asDate(s).getTime()) / 2629800000)
  if (m < 1) return 'Joined this month'
  if (m < 12) return `${m} mo`
  const y = Math.floor(m / 12), r = m % 12
  return `${y} yr${r ? ` ${r} mo` : ''}`
}
/** Days from today to a date (negative when past). */
export const daysTo = (s: string, today: Date) => Math.round((asDate(s).getTime() - today.getTime()) / 864e5)
/** Minutes after midnight as "09:30". */
export const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** A shift's hours ("09:30–18:30"), or its core hours when flexible. */
export const shiftHours = (s: Rec) => (s.kind === 'Flexible' && s.core ? `core ${hm(s.core[0])}–${hm(s.core[1])}` : `${hm(s.start)}–${hm(s.end)}`)
/** "₹12L", "₹1.5 Cr": a grade's pay band. */
export function fmtL(n: number): string {
  if (n >= 1e7) { const c = n / 1e7; return `₹${Number.isInteger(c) ? c : c.toFixed(2)} Cr` }
  const l = n / 1e5
  return `₹${Number.isInteger(l) ? l : l.toFixed(1)}L`
}

/** Active headcount at the end of each of the last 11 months and today, from the records (when the server's figures aren't there). */
export function localActiveSeries(list: Rec[], today: Date, liveNow: number): number[] {
  const out = Array.from({ length: 12 }, (_, i) => {
    const iso = new Date(today.getFullYear(), today.getMonth() - 10 + i, 0).toISOString().slice(0, 10)
    return list.filter((e) => e.joined <= iso && !(e.exitOn && e.exitOn <= iso)).length
  })
  out[11] = liveNow
  return out
}
