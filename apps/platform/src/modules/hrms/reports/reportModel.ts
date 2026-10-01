// Pure helpers of the Reports center (P-REPORTS), kept apart so they're unit tested:
// the dashboard date carried into each report, the tile mini charts built from
// /v1/reports/summary, and the hero's change lines.
import type { DiversityRow, ReportSummary } from '@/modules/hrms/api/useReports'
import type { ReportSchedule } from '@/modules/hrms/api/useReportExports'

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The date the admin dashboard was showing (?asOf=, a past day) for each report
 * that takes one: headcount and diversity as of that day, attendance summary and
 * late marks for its month up to it, attrition for the 12 months up to it. Others: none.
 */
export function datedParams(to: string, asOf: string): Record<string, string> {
  const [y, m] = asOf.split('-').map(Number)
  const monthStart = (back: number) => isoDate(new Date(y, m - 1 - back, 1))
  if (to === '/hrms/reports/headcount' || to === '/hrms/reports/diversity') return { asOf }
  if (to === '/hrms/reports/attendance-summary' || to === '/hrms/reports/late-marks') return { from: monthStart(0), to: asOf }
  if (to === '/hrms/reports/attrition') return { from: monthStart(11), to: asOf }
  return {}
}

/** A tile's small chart (prototype kinds: bars, line, split), or a line of text when there is nothing to draw. */
export type Mini = { kind: 'bars'; values: number[]; hi: number[] } | { kind: 'line'; values: number[] } | { kind: 'split'; a: number; aLabel: string; bLabel: string } | { kind: 'none'; text: string }

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
export function miniFor(key: string, s: ReportSummary | undefined): Mini | null {
  if (!s) return null
  switch (key) {
    case 'headcount': {
      const v = (s.headcount?.departments ?? []).slice(0, 8).map((x) => x.count)
      return v.length ? { kind: 'bars', values: v, hi: [0] } : { kind: 'none', text: 'No one on the rolls yet' }
    }
    case 'attrition': {
      const v = (s.attrition?.months ?? []).map((x) => x.pct)
      return v.length ? { kind: 'line', values: v } : null
    }
    case 'diversity': {
      const g = s.diversity
      if (!g || !g.total) return { kind: 'none', text: 'No one counted yet' }
      if (!g.women && !g.men) return { kind: 'none', text: 'No gender recorded yet' }
      return { kind: 'split', a: pct(g.men, g.total), aLabel: `${pct(g.men, g.total)}% men`, bLabel: `${pct(g.women, g.total)}% women` }
    }
    case 'attendance': {
      const v = (s.attendance?.days ?? []).map((x) => x.present)
      return v.length ? { kind: 'bars', values: v, hi: [v.length - 1] } : null
    }
    case 'late': {
      const v = (s.lateMarks?.days ?? []).map((x) => x.count)
      return v.length ? { kind: 'line', values: v } : null
    }
    case 'leave': {
      const l = s.leaveBalance
      if (!l) return null
      const all = l.used + Math.max(0, l.available)
      if (!all) return { kind: 'none', text: `No balances for ${l.year} yet` }
      return { kind: 'split', a: pct(l.used, all), aLabel: `${pct(l.used, all)}% used`, bLabel: `${100 - pct(l.used, all)}% available` }
    }
    default: return null
  }
}

/** "+6 this month", "2 fewer this month", "No change this month". */
export const changeText = (n: number, when: string) => (n > 0 ? `+${n} ${when}` : n < 0 ? `${-n} fewer ${when}` : `No change ${when}`)
export const ptsText = (delta: number, against: string) => {
  const r = Math.round(delta * 10) / 10
  return r > 0 ? `${r.toFixed(1)} pts higher than ${against}` : r < 0 ? `${(-r).toFixed(1)} pts lower than ${against}` : `Same as ${against}`
}
/** "+2 pts since 1 Apr", "3 pts lower since 1 Apr", "No change since 1 Apr". */
export const ptsSince = (delta: number, since: string) => {
  const r = Math.round(delta)
  return r > 0 ? `+${r} pts since ${since}` : r < 0 ? `${-r} pts lower since ${since}` : `No change since ${since}`
}
export const womenPct = (rows: DiversityRow[] | undefined) => {
  if (!rows) return null
  const all = rows.reduce((a, r) => a + Number(r.count || 0), 0)
  const w = rows.filter((r) => r.gender === 'FEMALE').reduce((a, r) => a + Number(r.count || 0), 0)
  return all ? (w * 100) / all : null
}

// ── scheduled emails ──
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
/** The first run of the day: 07:05 India time, shown as 07:00. */
export const FIRST_RUN = 7
/** "Every Monday, 09:00", "Every weekday, 11:00", "1st of every month, 07:00". */
export const scheduleWhen = (s: Pick<ReportSchedule, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'sendHour'>) => {
  const at = hh(s.sendHour ?? FIRST_RUN)
  switch (s.frequency) {
    case 'DAILY': return `Every day, ${at}`
    case 'WEEKDAYS': return `Every weekday, ${at}`
    case 'WEEKLY': return `Every ${WEEKDAYS[(s.dayOfWeek || 1) - 1]}, ${at}`
    default: return `${ordinal(s.dayOfMonth || 1)} of every month, ${at}`
  }
}
