// Pure pieces of Attendance analytics (P-ATT-PLAN): the month on show, the design's stat notes, the trend bars and the
// calendar cells. Kept free of React so vitest covers them.
import { MON, MONTHS, WD, WDL, addDays, dt } from '@/design/dc/dates'
import type { DayBuckets } from '../attendanceBuckets'

/** The month Analytics shows: ?month=yyyy-MM for a past month, else this month to date. */
export function analyticsMonth(monthArg: string | null, today: string) {
  const cur = today.slice(0, 7)
  const month = monthArg && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthArg) && monthArg < cur ? monthArg : cur
  const past = month < cur
  return { month, past, from: `${month}-01`, to: past ? monthEnd(month) : today, current: cur }
}

/** Last day of a 'yyyy-MM' month, as yyyy-MM-dd. */
export const monthEnd = (ym: string) => `${ym}-${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, '0')}`

export const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]
export const monthLabel = (iso: string) => `${monthName(iso)} ${iso.slice(0, 4)}`

/** 94.2 → "94.2%"; nothing to show → null (the page shows a dash). */
export const pct = (v: number | null | undefined) => (v == null ? null : `${v.toFixed(1)}%`)

/** The attendance rate against the period before: "Up 1.1% on August", "Down 0.4% on August", "Same as August". */
export function rateDelta(cur: number | null | undefined, prev: number | null | undefined, prevName: string) {
  if (cur == null || prev == null) return null
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return { text: `Same as ${prevName}`, trend: 'flat' as const, mood: 'flat' as const }
  return d > 0
    ? { text: `Up ${d.toFixed(1)}% on ${prevName}`, trend: 'up' as const, mood: 'good' as const }
    : { text: `Down ${Math.abs(d).toFixed(1)}% on ${prevName}`, trend: 'down' as const, mood: 'bad' as const }
}

/** Average arrival against the shift's start: "9 min before shift", "1h 05m after shift", "On the dot". */
export function arrivalNote(minutes: number | null | undefined) {
  if (minutes == null) return null
  const m = Math.round(Math.abs(minutes))
  if (m === 0) return 'Right at the shift start'
  const t = m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
  return minutes < 0 ? `${t} before shift` : `${t} after shift`
}

/** ISO weekday (1 = Monday) → "Mondays". */
export const weekdayPlural = (iso: number | null | undefined) => (iso && iso >= 1 && iso <= 7 ? `${WDL[iso % 7]}s` : null)

/** Late marks against the period before: rising (more), falling (fewer) or steady. */
export function lateTrend(cur: number, prev: number): { label: 'Rising' | 'Steady' | 'Falling'; tone: 'danger' | 'warning' | 'success' } {
  if (cur > prev) return { label: 'Rising', tone: 'danger' }
  if (cur < prev) return { label: 'Falling', tone: 'success' }
  return { label: 'Steady', tone: 'warning' }
}

/** A department or branch bar: green from 95%, gold below (the design's two tones). */
export const barTone = (rate: number | null) => (rate != null && rate >= 95 ? 'brand' as const : 'warning' as const)

/** Minutes → "1h 05m", "2h", "45m". */
export const dur = (n: number) => {
  const v = Math.round(n || 0), h = Math.floor(v / 60), m = v % 60
  return h && m ? `${h}h ${String(m).padStart(2, '0')}m` : h ? `${h}h` : `${m}m`
}

/** Weekly off for a day: the trend flags a day nobody was scheduled; otherwise the weekday pattern. */
export const isOffDay = (iso: string, daily: Record<string, DayBuckets>, offWd: number[]) => {
  const r = daily[iso]
  return r && typeof r.weeklyOff === 'boolean' ? r.weeklyOff : offWd.includes(dt(iso).getDay())
}

// ── the trend chart (one bar a day) ──────────────────────────────────────────

export interface TrendDay {
  iso: string
  x: number; w: number
  /** On time (or the day-off stub), late and absent, stacked upwards. */
  y1: number; h1: number; off: boolean
  y2: number; h2: number
  y3: number; h3: number
  cx: number; label: string; today: boolean
  hx: number; hy: number; hw: number; hh: number
  tip: string
}

export interface TrendChart { width: number; height: number; days: TrendDay[]; grid: { y: number; label: string; x1: number; x2: number; dashed: boolean }[]; aria: string }

/**
 * The month's bars, as the page has always drawn them: one bar per day up to today (this month) or every day (a past
 * month); on time, late and absent stacked; a short grey stub on a weekly off or a holiday.
 */
export function trendChart(o: { month: string; today: string; past: boolean; daily: Record<string, DayBuckets>; holidays: Record<string, string>; offWd: number[]; mobile: boolean }): TrendChart {
  const { month, today, past, daily, holidays, offWd, mobile } = o
  const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7)) - 1
  const n = past ? new Date(y, mo + 1, 0).getDate() : Number(today.slice(8, 10))
  const W = mobile ? 340 : 720, H = 214, pl = 30, pr = 4, pt = 10, pb = 26, pw = W - pl - pr, ph = H - pt - pb
  const cw = pw / Math.max(n, 1), bw = Math.max(6, Math.min(20, cw * 0.62))
  const f1 = (v: number) => Math.round(v * 10) / 10
  let peak = 0
  for (let i = 1; i <= n; i++) {
    const r = daily[`${month}-${String(i).padStart(2, '0')}`]
    peak = Math.max(peak, (r?.present || 0) + (r?.absent || 0))
  }
  const top = Math.max(10, Math.ceil(peak / 10) * 10), k = ph / top, base = pt + ph
  const days: TrendDay[] = []
  for (let i = 0; i < n; i++) {
    const day = i + 1, iso = `${month}-${String(day).padStart(2, '0')}`, r = daily[iso]
    const off = isOffDay(iso, daily, offWd) || !!holidays[iso], isToday = iso === today
    const onT = off ? 0 : Math.max(0, (r?.present || 0) - (r?.late || 0)), lt = off ? 0 : r?.late || 0, ab = off ? 0 : r?.absent || 0
    const x = pl + i * cw + (cw - bw) / 2, h1 = off ? 8 : onT * k, h2 = lt * k, h3 = ab * k
    const y1 = base - h1, y2 = y1 - h2 - (h2 ? 1.5 : 0), y3 = y2 - h3 - (h3 ? 1.5 : 0)
    const wd = dt(iso).getDay()
    days.push({
      iso, x: f1(x), w: f1(bw), y1: f1(y1), h1: f1(h1), off, y2: f1(y2), h2: f1(h2), y3: f1(y3), h3: f1(h3),
      cx: f1(x + bw / 2), label: !mobile || day % 3 === 1 || isToday ? String(day) : '', today: isToday,
      hx: f1(pl + i * cw + 1), hy: pt - 6, hw: f1(cw - 2), hh: f1(ph + 10),
      tip: off ? `${WD[wd]} ${day} ${MON[mo]} · ${holidays[iso] || 'weekly off'}`
        : `${WD[wd]} ${day} ${MON[mo]}${isToday ? ' (today)' : ''} · ${onT} on time · ${lt} late · ${ab} absent — tap to open that day`,
    })
  }
  const grid = [0, top / 3, (2 * top) / 3, top].map((v0) => {
    const v = Math.round(v0)
    return { y: f1(base - v * k), label: String(v), x1: pl, x2: W - pr, dashed: v !== 0 }
  })
  return { width: W, height: H, days, grid, aria: `Daily attendance for 1 to ${n} ${MON[mo]}, stacked by on time, late and absent` }
}

// ── the calendar ─────────────────────────────────────────────────────────────

export type DayKind = 'work' | 'holiday' | 'off' | 'future' | 'none'

/** came in ÷ (came in + absent + not marked), as the calendar has always shown it. */
export const dayRate = (r: DayBuckets | undefined) => {
  const e = (r?.present || 0) + (r?.absent || 0) + (r?.notMarked || 0)
  return e ? Math.round(((r?.present || 0) / e) * 100) : 0
}

export function dayKind(iso: string, o: { today: string; daily: Record<string, DayBuckets>; holidays: Record<string, string>; offWd: number[]; empty?: boolean }): DayKind {
  if (iso > o.today) return 'future'
  if (o.holidays[iso]) return 'holiday'
  if (isOffDay(iso, o.daily, o.offWd)) return 'off'
  // No one counted that day (before attendance was tracked, e.g. an old month): no data, not 0%.
  if (o.empty || !o.daily[iso] || !o.daily[iso].total) return 'none'
  return 'work'
}

/** Great from 95%, Good from 90%, else Needs a look. */
export const rateBand = (r: number) => (r >= 95 ? 'Great' : r >= 90 ? 'Good' : 'Needs a look')

/** The day the side panel opens on: the one picked in this month, else today, else the month's last working day. */
export function pickDay(sel: string | null, o: { month: string; today: string; daily: Record<string, DayBuckets>; holidays: Record<string, string>; offWd: number[] }) {
  const ym = o.month, dim = Number(monthEnd(ym).slice(8))
  if (sel && sel.slice(0, 7) === ym) return sel
  if (o.today.slice(0, 7) === ym) return o.today
  for (let d = dim; d >= 1; d--) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`
    if (dayKind(iso, o) === 'work') return iso
  }
  return `${ym}-${String(dim).padStart(2, '0')}`
}

/** Weekday-first (Monday) blanks before the 1st. */
export const leadingBlanks = (ym: string) => (new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).getDay() + 6) % 7

export { addDays }
