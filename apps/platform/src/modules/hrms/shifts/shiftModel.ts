// Pure rules behind the Shift change page (EmpTime.dc.html, e-shift): a shift's time span on a
// 24-hour bar, its working days in words, and the wording of a change request.
import { fmtShort } from '@/design/dc/dates'

const ISO_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "09:30". */
export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

/** "09:30–18:30", or '' without both times. */
export const timeRange = (start?: string | null, end?: string | null) => (start && end ? `${hhmm(start)}–${hhmm(end)}` : '')

const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }

/** The shift on a 24-hour bar, as percent segments (an overnight shift is two: to midnight and from it). */
export function barSegments(start?: string | null, end?: string | null): { left: number; width: number }[] {
  if (!start || !end) return []
  const a = minutes(start), b = minutes(end), day = 24 * 60
  const pct = (m: number) => Math.round((m / day) * 1000) / 10
  if (b > a) return [{ left: pct(a), width: pct(b - a) }]
  if (b === a) return [{ left: 0, width: 100 }]
  return [{ left: pct(a), width: pct(day - a) }, { left: 0, width: pct(b) }].filter((s) => s.width > 0)
}

/** The days a shift works, from its weekly offs (ISO 1 = Mon … 7 = Sun): "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri". Null when unknown. */
export function workDays(weeklyOffDays: readonly number[] | null | undefined): string | null {
  if (!weeklyOffDays) return null
  const off = new Set(weeklyOffDays)
  const on = [1, 2, 3, 4, 5, 6, 7].filter((d) => !off.has(d))
  if (!on.length) return null
  if (on.length === 7) return 'Every day'
  const consecutive = on.every((d, i) => i === 0 || d === on[i - 1] + 1)
  if (consecutive && on.length > 2) return `${ISO_DAYS[on[0] - 1]}–${ISO_DAYS[on[on.length - 1] - 1]}`
  return on.map((d) => ISO_DAYS[d - 1]).join(', ')
}

/** "8 people", "1 person"; null when the server didn't send the count. */
export const peopleWord = (n: number | null | undefined) => (n == null ? null : `${n} ${n === 1 ? 'person' : 'people'}`)

/** When a change runs: "From 5 Oct 2026", "5 Oct 2026 – 31 Oct 2026". */
export function changeDates(from: string | null | undefined, until: string | null | undefined): string {
  if (!from) return ''
  return until ? `${fmtShort(from)} – ${fmtShort(until)}` : `From ${fmtShort(from)}`
}

/** Why the form can't be sent yet, or null. Same reason rule as today (10–500 characters). */
export function shiftProblem(args: { picked: string | null; from: string; until: string; reason: string; min: string; max: string; scheduled: string | null }): string | null {
  const { picked, from, until, reason, min, max, scheduled } = args
  if (!picked) return 'Pick a shift to move to.'
  if (!from) return 'Pick the day it starts.'
  if (scheduled && from < scheduled) return `Your shift already changes on ${fmtShort(scheduled)}. Start on that day or later.`
  if (from < min) return 'The start can’t be in the past.'
  if (from > max) return 'The start must be within the next 12 months.'
  if (until && until < from) return 'Until must be on or after the start.'
  const r = reason.trim()
  if (r.length < 10) return `Say why in at least 10 characters (${r.length}/10).`
  if (r.length > 500) return 'Keep the reason to 500 characters.'
  return null
}
