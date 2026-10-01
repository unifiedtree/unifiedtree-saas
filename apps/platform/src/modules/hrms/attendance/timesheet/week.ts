// Timesheet week maths (EmpTime Timesheet): Monday-to-Sunday weeks in calendar dates (yyyy-MM-dd),
// the grid of time per project and day, and the totals. Pure, so it is unit tested.

export interface TimeEntry {
  id: string
  /** yyyy-MM-dd */
  workDate: string
  description: string
  minutes: number
  projectId?: string | null
  projectName?: string | null
  projectCode?: string | null
  /** In a submitted or approved week: it can't be changed. */
  locked?: boolean
}

const dt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The Monday of the week `day` falls in. */
export function mondayOf(day: string): string {
  const d = dt(day)
  const back = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - back)
  return iso(d)
}

/** The seven days from a Monday. */
export function weekDays(monday: string): string[] {
  const d = dt(monday)
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return iso(x) })
}

export const shiftWeek = (monday: string, weeks: number) => { const d = dt(monday); d.setDate(d.getDate() + weeks * 7); return iso(d) }

/** "Mon 21 – Fri 25 Sep" (or to Sunday when the weekend has time). */
export function weekLabel(days: string[], withWeekend: boolean): string {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const a = dt(days[0]), b = dt(days[withWeekend ? 6 : 4])
  const left = `${WD[a.getDay()]} ${a.getDate()}${a.getMonth() !== b.getMonth() ? ' ' + MON[a.getMonth()] : ''}`
  return `${left} – ${WD[b.getDay()]} ${b.getDate()} ${MON[b.getMonth()]}`
}

/** "8h 30m", "6h", "0h 30m", "—" for nothing. */
export function hours(minutes: number): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

export interface GridRow { key: string; name: string; code: string | null; perDay: number[]; total: number }

/** One row per project (entries without a project: one row per description), minutes per day of the week. */
export function weekGrid(entries: TimeEntry[], days: string[]): { rows: GridRow[]; perDay: number[]; total: number } {
  const rows = new Map<string, GridRow>()
  const perDay = days.map(() => 0)
  for (const e of entries) {
    const i = days.indexOf(e.workDate.slice(0, 10))
    if (i < 0) continue
    const key = e.projectId ? `p:${e.projectId}` : `d:${(e.description || '').trim().toLowerCase()}`
    const row = rows.get(key) || { key, name: e.projectId ? e.projectName || 'Project' : e.description?.trim() || 'Other work', code: e.projectId ? e.projectCode || null : null, perDay: days.map(() => 0), total: 0 }
    row.perDay[i] += e.minutes
    row.total += e.minutes
    perDay[i] += e.minutes
    rows.set(key, row)
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { rows: list, perDay, total: perDay.reduce((s, n) => s + n, 0) }
}

/** Why the week can't be submitted, or null. */
export function submitBlocker(monday: string, today: string, total: number, status: string | null): string | null {
  if (monday > mondayOf(today)) return 'You can submit a week once it has started.'
  if (status === 'SUBMITTED') return 'This week is waiting for approval.'
  if (status === 'APPROVED') return 'This week is approved.'
  if (!total) return 'Log some time first.'
  return null
}
