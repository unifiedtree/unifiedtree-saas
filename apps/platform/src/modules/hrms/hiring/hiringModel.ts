// What the Hiring page says about its rows (P-HIRE; prototype PgTalent h-pipe): stage and
// status pills, the next pipeline step, conversion and time-to-hire wording, interview
// status and India-time dates. Pure functions only, so the rules are unit-tested.
import type { StatusTone } from '@/design/kit/display'
import type { CandidateStage, Interview, OfferStatus, RequisitionStatus } from '../api/useHiring'

/** "FULL_TIME" → "Full Time" (as the page wrote enums before). */
export const fmtEnum = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

/** The pipeline in order. Rejected and Withdrawn are ways out, not steps. */
export const FUNNEL: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED']

export const STAGE_LABEL: Record<CandidateStage, string> = {
  APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
}
/** The design's stage pills: Hired ok, Offer info, Interview warn, the rest grey; the two exits stand apart. */
export const STAGE_TONE: Record<CandidateStage, StatusTone> = {
  APPLIED: 'neutral', SCREENING: 'neutral', INTERVIEW: 'warning', OFFER: 'info', HIRED: 'success', REJECTED: 'danger', WITHDRAWN: 'muted',
}

/** The next pipeline step (the server allows only one step forward), or null after Hired and on the exits. */
export function nextStage(stage: CandidateStage): CandidateStage | null {
  const i = FUNNEL.indexOf(stage)
  return i >= 0 && i < FUNNEL.length - 1 ? FUNNEL[i + 1] : null
}

export const REQUISITION_LABEL: Record<RequisitionStatus, string> = { OPEN: 'Open', ON_HOLD: 'On hold', CLOSED: 'Closed' }
export const REQUISITION_TONE: Record<RequisitionStatus, StatusTone> = { OPEN: 'success', ON_HOLD: 'warning', CLOSED: 'neutral' }

export const OFFER_LABEL: Record<OfferStatus, string> = { DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn' }
export const OFFER_TONE: Record<OfferStatus, StatusTone> = { DRAFT: 'warning', SENT: 'info', ACCEPTED: 'success', DECLINED: 'danger', WITHDRAWN: 'muted' }
/** Where an offer can go next (the server's rule); empty = a final decision. */
export const OFFER_NEXT: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ['SENT', 'WITHDRAWN'],
  SENT: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
}
/** The status change as an action. */
export const OFFER_ACTION: Record<OfferStatus, string> = {
  DRAFT: 'Back to draft', SENT: 'Mark as sent', ACCEPTED: 'Mark accepted', DECLINED: 'Mark declined', WITHDRAWN: 'Withdraw offer',
}

/** A conversion rate (0..1) as "36%"; "—" when there is none yet. */
export function pctLabel(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

/** Average days to hire as "31 days on average"; "—" when nobody tracked was hired. */
export function hireDaysLabel(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '—'
  const n = Math.round(days)
  return `${n} ${n === 1 ? 'day' : 'days'} on average`
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Today in India time, yyyy-MM-dd (interviews and the quarter are India time). */
export function istTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/** yyyy-MM-dd of an instant in India time. */
export function istDateOf(iso: string): string {
  return istTodayIso(new Date(iso))
}

function parts(day: string) {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** "2 Sep" this year, "2 Sep 2025" otherwise. */
export function dayMon(day: string | null | undefined, today: string): string {
  if (!day) return '—'
  const p = parts(day)
  if (!p.y || !p.m || !p.d) return '—'
  return `${p.d} ${MON[p.m - 1]}${String(p.y) === today.slice(0, 4) ? '' : ` ${p.y}`}`
}

/** "Thu, 15 Oct" this year, "Thu, 15 Oct 2027" otherwise (the design's joining dates). */
export function weekdayDay(day: string | null | undefined, today: string): string {
  if (!day) return '—'
  const p = parts(day)
  if (!p.y || !p.m || !p.d) return '—'
  return `${DOW[p.dow]}, ${dayMon(day, today)}`
}

/** When an interview is, in India time: "Today, 15:00 · 60 min" or "Mon 28 Sep, 11:00 · 45 min". */
export function interviewWhen(i: Pick<Interview, 'scheduledAtIst' | 'durationMinutes'>, today: string): string {
  const day = i.scheduledAtIst.slice(0, 10)
  const time = i.scheduledAtIst.slice(11, 16)
  const p = parts(day)
  const date = day === today ? 'Today' : `${DOW[p.dow]} ${dayMon(day, today)}`
  return `${date}, ${time} · ${i.durationMinutes} min`
}

export interface InterviewState { label: string; tone: StatusTone }

/**
 * The status of an interview in the "Coming up" table (design: Today, Scheduled,
 * Scorecard due, Scorecard in). `mine` is the signed-in interviewer's own copy of it
 * (its scorecards are only theirs): then "due" means their own scorecard is missing.
 */
export function interviewState(
  i: Pick<Interview, 'status' | 'started' | 'scheduledAtIst' | 'interviewers'>, today: string,
  mine?: Pick<Interview, 'scorecards'> | null,
): InterviewState {
  if (i.status === 'CANCELLED') return { label: 'Cancelled', tone: 'muted' }
  if (!i.started) return i.scheduledAtIst.slice(0, 10) === today ? { label: 'Today', tone: 'info' } : { label: 'Scheduled', tone: 'neutral' }
  const due = mine ? mine.scorecards.length === 0 : i.interviewers.some((p) => !p.submitted)
  return due ? { label: 'Scorecard due', tone: 'warning' } : { label: 'Scorecard in', tone: 'success' }
}

/** Who is on the panel, a tick after those who filed a scorecard: "Siddharth Rao ✓, Priya Sharma". */
export function interviewersLine(i: Pick<Interview, 'interviewers'>): string {
  return i.interviewers.map((p) => `${p.name}${p.submitted ? ' ✓' : ''}`).join(', ')
}

export interface InterviewRow {
  id: string
  /** The fullest copy: HR's (every scorecard) when there is one, else the interviewer's own. */
  interview: Interview
  /** The signed-in person's own copy (their scorecard only) when they are on the panel. */
  mine: Interview | null
}

/**
 * The "Coming up" rows: everything still scheduled plus the signed-in person's own
 * interviews (theirs include the last 60 days, so a scorecard still due shows), once
 * each, oldest first.
 */
export function mergeInterviews(upcoming: readonly Interview[], mine: readonly Interview[]): InterviewRow[] {
  const rows = new Map<string, InterviewRow>()
  for (const i of upcoming) rows.set(i.id, { id: i.id, interview: i, mine: null })
  for (const i of mine) {
    const row = rows.get(i.id)
    rows.set(i.id, row ? { ...row, mine: i } : { id: i.id, interview: i, mine: i })
  }
  return [...rows.values()].sort((a, b) => a.interview.scheduledAt.localeCompare(b.interview.scheduledAt))
}
