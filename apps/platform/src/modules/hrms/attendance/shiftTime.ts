/**
 * "09:00:00" → "09:00 AM" for DISPLAY.
 *
 * The mobile Shift Timings screen renders 12-hour AM/PM and carries a note
 * that the client asked for exactly that ("no 24h clock, just AM PM 1 to 12").
 * The web was still showing raw 24-hour values, so the same shift read
 * "18:00" here and "06:00 PM" on a phone. Display only — the shift form still
 * feeds <input type="time"> HH:mm values.
 */
export const hhmm = (t?: string | null) => {
  if (!t) return '—'
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
  if (!m) return t
  const h24 = Math.max(0, Math.min(23, parseInt(m[1], 10)))
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)))
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`
}
