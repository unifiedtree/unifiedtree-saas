// Date helpers for the design components. Business dates are IST (Asia/Kolkata).
export function istToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
/** Hour of the day in IST (0–23). */
export function istHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now)) % 24
}
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const dt = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00')
export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (iso: string, n: number) => { const d = dt(iso); d.setDate(d.getDate() + n); return isoOf(d) }
/** 18 Sep 2026 */
export const fmtShort = (iso: string) => { const d = dt(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
/** Wed, 23 Sep 2026 */
export const fmtWd = (iso: string) => `${WD[dt(iso).getDay()]}, ${fmtShort(iso)}`
/** Wednesday, 23 September 2026 */
export const fmtLong = (iso: string) => { const d = dt(iso); return `${WDL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
