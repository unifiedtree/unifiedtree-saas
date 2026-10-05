// Pure rules behind the work-from-home page (EmpTime.dc.html, e-wfh): which days show as chips,
// which of them can't be picked and why, and the wording of a pick and a request.
import { MON, WD, addDays, dt } from '@/design/dc/dates'
import type { WfhRequestResponse } from '../api/useWfh'

/** Requests that hold their days (another request can't overlap them). */
export const WFH_HOLDING = new Set(['PENDING', 'PENDING_L2', 'APPROVED'])

/** The working days (not a weekly off) from `start` on, `count` of them, at most `horizon` days ahead of start. */
export function workingDays(start: string, count: number, off: ReadonlySet<number>, horizon = 366): string[] {
  const out: string[] = []
  for (let d = start, i = 0; out.length < count && i < horizon; d = addDays(d, 1), i++) {
    if (!off.has(dt(d).getDay())) out.push(d)
  }
  return out
}

/** The working day after `day` (the start of the next page of chips). */
export function nextWorkingDay(day: string, off: ReadonlySet<number>): string {
  return workingDays(addDays(day, 1), 1, off)[0] ?? addDays(day, 1)
}

export type BlockReason = 'Holiday' | 'Leave' | 'Asked' | 'Approved'

/** Why a day can't be picked, or null when it can: a holiday, leave, or a work-from-home request already on it. */
export function blockOf(day: string, ctx: { holidays: ReadonlyMap<string, string>; leave: ReadonlySet<string>; wfh: ReadonlyMap<string, string> }): BlockReason | null {
  if (ctx.holidays.has(day)) return 'Holiday'
  if (ctx.leave.has(day)) return 'Leave'
  const w = ctx.wfh.get(day)
  if (w === 'APPROVED') return 'Approved'
  if (w) return 'Asked'
  return null
}

/** Each day a waiting or approved request covers, with its status. */
export function wfhDayMap(requests: readonly WfhRequestResponse[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of requests) {
    if (!WFH_HOLDING.has(r.status)) continue
    for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) out.set(d, r.status)
  }
  return out
}

/** "Mon 5". */
export const chipDay = (iso: string) => { const d = dt(iso); return { dow: WD[d.getDay()], date: `${d.getDate()} ${MON[d.getMonth()]}` } }

/** "3 days: Mon 5 Oct, Tue 6 Oct, Thu 8 Oct" or "No days picked yet". */
export function pickLine(days: readonly string[]): string {
  if (!days.length) return 'No days picked yet'
  const sorted = [...days].sort()
  const words = sorted.map((d) => { const c = chipDay(d); return `${c.dow} ${c.date}` })
  return `${sorted.length} ${sorted.length === 1 ? 'day' : 'days'}: ${words.join(', ')}`
}

/**
 * The days a range from "Select dates" adds to the picked chips: each day from `from` to `to`
 * that isn't a weekly off and has nothing on it (blockOf), kept with the days already picked,
 * sorted, and at most `max` in all (the earliest first).
 */
export function addRange(
  picked: readonly string[], from: string, to: string, off: ReadonlySet<number>,
  ctx: Parameters<typeof blockOf>[1], max: number,
): string[] {
  const out = new Set(picked)
  for (let d = from, i = 0; d <= to && i < 366; d = addDays(d, 1), i++) {
    if (out.size >= max) break
    if (off.has(dt(d).getDay()) || blockOf(d, ctx)) continue
    out.add(d)
  }
  return [...out].sort()
}

/** Calendar days a request covers. */
export function spanDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? 0 : Math.round((b - a) / 86_400_000) + 1
}

/** Who a request is with, as the list's second line: "With Siddharth Rao", "Approved by Siddharth Rao". */
export function withLine(r: Pick<WfhRequestResponse, 'status' | 'approverName'>): string {
  const who = r.approverName?.trim()
  if (!who) return ''
  switch (r.status) {
    case 'PENDING': case 'PENDING_L2': return `With ${who}`
    case 'APPROVED': return `Approved by ${who}`
    case 'REJECTED': return `Rejected by ${who}`
    default: return ''
  }
}
