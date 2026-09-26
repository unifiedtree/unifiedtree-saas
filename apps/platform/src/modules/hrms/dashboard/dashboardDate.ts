// The admin dashboard's date: kept in the URL (?date=yyyy-MM-dd) so a refresh or
// the browser's Back button keeps it. Only past days are a "history" date; today
// (or no date) is the live view. Dates after today can't be chosen.
import { addDays, dt, isoOf, MON } from '@/design/dc/dates'

export interface DashboardDate {
  /** The past day being viewed, or null for today's live view. */
  date: string | null
  /** The URL asked for a day after today (shown as today, with a note). */
  future: boolean
  /** The URL's date wasn't a real yyyy-MM-dd day (ignored). */
  invalid: boolean
}

/** Reads the ?date= value against today's IST date. */
export function parseDashboardDate(raw: string | null | undefined, today: string): DashboardDate {
  if (!raw) return { date: null, future: false, invalid: false }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isoOf(dt(raw)) !== raw) return { date: null, future: false, invalid: true }
  if (raw > today) return { date: null, future: true, invalid: false }
  return { date: raw < today ? raw : null, future: false, invalid: false }
}

/** The last millisecond of an IST day, as a UTC instant (the audit log's inclusive `to`). */
export function endOfIstDay(iso: string): string {
  const next = addDays(iso, 1)
  const [y, m, d] = next.split('-').map(Number)
  // 00:00 IST is 18:30 UTC the day before.
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600_000 - 1).toISOString()
}

/** "1–14 Mar 2025": from the first of the date's month to the date. */
export function monthToDate(iso: string): string {
  const d = dt(iso), mon = MON[d.getMonth()]
  return d.getDate() === 1 ? `1 ${mon} ${d.getFullYear()}` : `1–${d.getDate()} ${mon} ${d.getFullYear()}`
}

/** The last `count` months of finalized payroll that end at the selected month (yyyy-MM). */
export function payrollWindow<T extends { month: string }>(months: T[], selMonth: string, count = 6): T[] {
  return months.filter((m) => m.month <= selMonth).slice(-count)
}
