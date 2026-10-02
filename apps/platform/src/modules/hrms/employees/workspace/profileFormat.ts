// Small formatters the profile pages share (dates in India's calendar, money, tenure).
import { istToday } from '@/design/dc/dates'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const parse = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00` : s)

/** "12 Mar 2022"; "—" when empty or not a date. */
export function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = parse(s)
  return isNaN(+d) ? '—' : `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
}

/** An instant as "Today 09:21", "Yesterday 18:02" or "2 Oct 2026, 09:21", in the viewer's clock (India). */
export function fmtDateTime(s?: string | null, today = istToday()): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(+d)) return '—'
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
  const yest = new Date(`${today}T12:00:00`); yest.setDate(yest.getDate() - 1)
  const y = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
  if (day === today) return `Today ${time}`
  if (day === y) return `Yesterday ${time}`
  return `${fmtDate(day)}, ${time}`
}

/** Whole days from `today` to `s` (negative = in the past). */
export function daysUntil(s: string, today = istToday()): number {
  return Math.round((parse(s).getTime() - parse(today).getTime()) / 86_400_000)
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "4 yrs 6 mos" since the joining date; '' before it or without one. */
export function tenure(joined?: string | null, today = istToday()): string {
  if (!joined) return ''
  const a = parse(joined), b = parse(today)
  if (isNaN(+a) || b < a) return ''
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months -= 1
  const y = Math.floor(months / 12), m = months % 12
  if (y === 0 && m === 0) return 'less than a month'
  return [y ? `${y} ${y === 1 ? 'yr' : 'yrs'}` : '', m ? `${m} ${m === 1 ? 'mo' : 'mos'}` : ''].filter(Boolean).join(' ')
}

/** ₹ with Indian grouping, whole rupees. */
export const inr = (n?: number | string | null) => (n == null || n === '' || isNaN(Number(n)) ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN'))

/** Hours as "26h 40m". */
export const hrs = (h?: number | null) => { if (h == null) return '—'; const a = Math.floor(h), m = Math.round((h - a) * 60); return m ? `${a}h ${m}m` : `${a}h` }
