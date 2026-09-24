// Shift helpers ported from the design export (window.ShiftUtil).
export interface ShiftTone { label: string; icon: string; bg: string; border: string; fg: string; bar: string }
export const tones: Record<string, ShiftTone> = {
  sunrise: { label: 'Early', icon: 'sunrise', bg: '#fffbeb', border: '#fde68a', fg: '#b45309', bar: '#f59e0b' },
  sun: { label: 'Daytime', icon: 'sun', bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857', bar: '#10b981' },
  sunset: { label: 'Evening', icon: 'sunset', bg: '#fff7ed', border: '#fed7aa', fg: '#c2410c', bar: '#f97316' },
  moon: { label: 'Night', icon: 'moon', bg: '#eef2ff', border: '#c7d2fe', fg: '#4338ca', bar: '#6366f1' },
}
export const FALLBACK_TONE: ShiftTone = { label: 'Shift', icon: 'clock', bg: '#f1f5f9', border: '#e2e8f0', fg: '#475569', bar: '#94a3b8' }
export const mins = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
export const fmt = (t?: string | null) => {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  return (h % 12 || 12) + ':' + String(m || 0).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM')
}
export const span = (s: string, e: string) => { const d = (mins(e) - mins(s) + 1440) % 1440; return d || 1440 }
export const overnight = (s: string, e: string) => mins(e) <= mins(s)
export const dur = (n: number) => {
  n = Math.round(n || 0)
  const h = Math.floor(n / 60), m = n % 60
  return h && m ? h + 'h ' + String(m).padStart(2, '0') + 'm' : h ? h + 'h' : m + 'm'
}
export const addMin = (t: string, n: number) => {
  const x = (((mins(t) + n) % 1440) + 1440) % 1440
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0')
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayLabel = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00'); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() }
/** Tone from the shift's start time (the API stores no colour): early, daytime, evening or night. */
export function toneFor(start: string, night?: boolean): string {
  if (night) return 'moon'
  const m = mins(start)
  if (m >= 240 && m < 540) return 'sunrise'
  if (m >= 540 && m < 780) return 'sun'
  if (m >= 780 && m < 1200) return 'sunset'
  return 'moon'
}
export const ShiftUtil = { tones, mins, fmt, span, overnight, dur, addMin, dayLabel }
