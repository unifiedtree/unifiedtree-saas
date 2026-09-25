// Date ranges for the "Upcoming milestones" lists (birthdays, work
// anniversaries, retirements): the presets, the custom range's 12-month cap,
// labels, and the "View all" link. Business dates are IST (see dates.ts).
import { addDays, dt, isoOf, fmtShort, MON } from './dates'

export type MilestoneKind = 'birthdays' | 'anniversaries' | 'retirements'
export type RangePreset = 'default' | 'this-month' | 'next-month' | 'next-3' | 'next-6' | 'this-year' | 'custom'
/** What a list shows: a preset, or a custom range with its own dates. */
export interface RangeChoice { preset: RangePreset; from?: string; to?: string }
/** yyyy-MM-dd, both ends included. */
export interface DateRange { from: string; to: string }

/** Each list's look-ahead until someone picks a range: the card's windows before ranges existed. */
export const DEFAULT_WINDOW: Record<MilestoneKind, { label: string; days?: number; months?: number }> = {
  birthdays: { label: 'Next 14 days', days: 14 },
  anniversaries: { label: 'Next 31 days', days: 31 },
  retirements: { label: 'Next 6 months', months: 6 },
}
export const DEFAULT_CHOICE: RangeChoice = { preset: 'default' }

const NOUN: Record<MilestoneKind, string> = { birthdays: 'birthdays', anniversaries: 'work anniversaries', retirements: 'retirements' }
/** The directory's milestone filter for each list (/hrms/employees?filter=…). */
const FILTER: Record<MilestoneKind, string> = { birthdays: 'birthday', anniversaries: 'anniversary', retirements: 'retirement' }

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** The same day n months on; a day the month doesn't have moves back to its last day (31 Aug + 6 → 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const d = dt(iso), day = d.getDate()
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))
  return isoOf(t)
}
const endOfMonth = (iso: string) => { const d = dt(iso); return isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }

/** The latest end a range starting on `from` may have: 12 months less a day (the server refuses longer). */
export const maxTo = (from: string) => addDays(addMonths(from, 12), -1)

/** A usable range: real dates, the end not before the start, at most 12 months. */
export function isValidRange(from?: string | null, to?: string | null): boolean {
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) return false
  if (Number.isNaN(dt(from).getTime()) || Number.isNaN(dt(to).getTime()) || isoOf(dt(from)) !== from || isoOf(dt(to)) !== to) return false
  return from <= to && to <= maxTo(from)
}

/** The dates a preset covers, counted from today. Presets look ahead: "This month" is today to the month's end. */
export function presetRange(kind: MilestoneKind, preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case 'this-month': return { from: today, to: endOfMonth(today) }
    case 'next-month': { const first = addMonths(today.slice(0, 8) + '01', 1); return { from: first, to: endOfMonth(first) } }
    case 'next-3': return { from: today, to: addMonths(today, 3) }
    case 'next-6': return { from: today, to: addMonths(today, 6) }
    case 'this-year': return { from: today, to: `${today.slice(0, 4)}-12-31` }
    default: {
      const w = DEFAULT_WINDOW[kind]
      return { from: today, to: w.days ? addDays(today, w.days) : addMonths(today, w.months || 6) }
    }
  }
}

/** The dates a list covers now; a custom range without usable dates falls back to the list's window. */
export function rangeOf(kind: MilestoneKind, choice: RangeChoice, today: string): DateRange {
  if (choice.preset === 'custom') return isValidRange(choice.from, choice.to) ? { from: choice.from!, to: choice.to! } : presetRange(kind, 'default', today)
  return presetRange(kind, choice.preset, today)
}

/** The range to ask the server for; null while a list shows its own window (the server's default). */
export function serverRange(kind: MilestoneKind, choice: RangeChoice, today: string): DateRange | null {
  if (choice.preset === 'default' || (choice.preset === 'custom' && !isValidRange(choice.from, choice.to))) return null
  return rangeOf(kind, choice, today)
}

/** The choices for one list, in menu order. Retirements' own window is "Next 6 months". */
export function rangeOptions(kind: MilestoneKind): { value: RangePreset; label: string }[] {
  const presets: { value: RangePreset; label: string }[] = [
    { value: 'this-month', label: 'This month' },
    { value: 'next-month', label: 'Next month' },
    { value: 'next-3', label: 'Next 3 months' },
    { value: 'next-6', label: 'Next 6 months' },
    { value: 'this-year', label: 'This year' },
  ]
  const own = { value: 'default' as RangePreset, label: DEFAULT_WINDOW[kind].label }
  const list = kind === 'retirements' ? presets.map((p) => (p.value === 'next-6' ? own : p)) : [own, ...presets]
  return [...list, { value: 'custom', label: 'Custom range' }]
}

export const choiceLabel = (kind: MilestoneKind, choice: RangeChoice) =>
  rangeOptions(kind).find((o) => o.value === choice.preset)?.label || DEFAULT_WINDOW[kind].label

const dayMon = (iso: string) => `${dt(iso).getDate()} ${MON[dt(iso).getMonth()]}`
/** "26 – 30 Sep 2026", "26 Sep – 26 Dec 2026", "15 Dec 2026 – 20 Jan 2027". */
export function rangeLabel(r: DateRange): string {
  const y1 = r.from.slice(0, 4), y2 = r.to.slice(0, 4)
  if (r.from === r.to) return fmtShort(r.from)
  if (y1 !== y2) return `${fmtShort(r.from)} – ${fmtShort(r.to)}`
  if (r.from.slice(0, 7) === r.to.slice(0, 7)) return `${dt(r.from).getDate()} – ${fmtShort(r.to)}`
  return `${dayMon(r.from)} – ${fmtShort(r.to)}`
}

/** What an empty list says, in the words of its range. */
export function emptyText(kind: MilestoneKind, choice: RangeChoice): string {
  const n = NOUN[kind]
  switch (choice.preset) {
    case 'this-month': return `No ${n} in the rest of this month.`
    case 'next-month': return `No ${n} next month.`
    case 'next-3': return `No ${n} in the next 3 months.`
    case 'next-6': return `No ${n} in the next 6 months.`
    case 'this-year': return `No ${n} in the rest of this year.`
    case 'custom': return `No ${n} in these dates.`
    default: return `No ${n} in the ${DEFAULT_WINDOW[kind].label.toLowerCase()}.`
  }
}

/** "View all": the directory on the same people. A list on its own window keeps the old link. */
export function viewAllPath(kind: MilestoneKind, choice: RangeChoice, today: string): string {
  const base = `/hrms/employees?filter=${FILTER[kind]}`
  const r = serverRange(kind, choice, today)
  return r ? `${base}&from=${r.from}&to=${r.to}` : base
}

/** The row's two labels (the same wording as before ranges), including dates already past in a custom range. */
export function rowLabels(kind: MilestoneKind, date: string, years: number | null, today: string): { when: string; sub: string } {
  const days = Math.round((dt(date).getTime() - dt(today).getTime()) / 86400000)
  const ago = (n: number) => (n > 45 ? `${Math.round(n / 30)} months ago` : `${n} days ago`)
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : kind === 'retirements' ? fmtShort(date) : days < 0 ? `${-days} days ago` : `in ${days} days`
  const y = years ?? 1
  const sub = kind === 'anniversaries' ? `${y} ${y === 1 ? 'year' : 'years'}`
    : kind === 'retirements' ? (days < 0 ? ago(-days) : days > 45 ? `in ${Math.round(days / 30)} months` : `in ${days} days`)
      : fmtShort(date).slice(0, -5)
  return { when, sub }
}
