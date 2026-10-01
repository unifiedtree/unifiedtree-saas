// Pure rules behind the redesigned Performance, Learning and Resignation & exit pages
// (P-GROW). Everything here only shapes real API values for display; unit-tested in
// growModel.test.ts.
import type { StepItem } from '@/design/kit/display'
import type { StatusTone } from '@/design/kit/StatusPill'
import type { CycleMilestones, GoalStatus, PerformanceReview, ReviewCycle, ReviewStatus } from '../api/usePerformance'
import type { CycleStages } from '../api/usePerformanceAdmin'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)

/** The India date (yyyy-MM-dd) of an instant such as submittedAt; a plain date passes through. */
export function istDay(instant: string): string {
  if (instant.length <= 10) return instant
  const t = Date.parse(instant)
  return Number.isNaN(t) ? instant.slice(0, 10) : new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

/** "Wed, 30 Sep" (the year only when it isn't `today`'s). */
export function dayMon(iso: string | null | undefined, today?: string): string {
  if (!iso) return '—'
  const d = day(iso)
  const year = today && today.slice(0, 4) === iso.slice(0, 4) ? '' : ` ${d.getFullYear()}`
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}${year}`
}

/** "30 Sep 2026". */
export function dateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = day(iso)
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
}

/** "Jul – Sep 2026", "Oct 2026 – Mar 2027", "Not set". */
export function periodLabel(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'Not set'
  if (!start || !end) return dateLong(start || end)
  const a = day(start), b = day(end)
  if (a.getFullYear() === b.getFullYear()) {
    return a.getMonth() === b.getMonth() ? `${MON[a.getMonth()]} ${a.getFullYear()}` : `${MON[a.getMonth()]} – ${MON[b.getMonth()]} ${b.getFullYear()}`
  }
  return `${MON[a.getMonth()]} ${a.getFullYear()} – ${MON[b.getMonth()]} ${b.getFullYear()}`
}

// ── Ratings (AUDIT §5.11: the admin label set, decimals kept) ───────────────

export const RATING_WORDS: Record<number, string> = { 5: 'Outstanding', 4: 'Exceeds', 3: 'Meets', 2: 'Needs support', 1: 'Below' }

/** The word for a rating by its whole number (4.6 → Exceeds, as the design reads it; under 1 → Below). */
export function ratingWord(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(Number(rating))) return null
  const r = Math.max(1, Math.min(5, Math.floor(Number(rating))))
  return RATING_WORDS[r]
}

/** "4.6 · Exceeds", or the fallback when not rated. */
export function ratingText(rating: number | null | undefined, fallback = 'Not rated yet'): string {
  const w = ratingWord(rating)
  return w ? `${Number(rating)} · ${w}` : fallback
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export function reviewStatus(status: ReviewStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'PENDING': return { label: 'Waiting', tone: 'warning' }
    case 'IN_PROGRESS': return { label: 'Draft saved', tone: 'info' }
    case 'SUBMITTED': return { label: 'Submitted', tone: 'success' }
    case 'ACKNOWLEDGED': return { label: 'Acknowledged', tone: 'success' }
    case 'MISSED': return { label: 'Missed', tone: 'danger' }
    default: return { label: String(status), tone: 'neutral' }
  }
}

export const isWaiting = (s: ReviewStatus) => s === 'PENDING' || s === 'IN_PROGRESS'
export const isSubmitted = (s: ReviewStatus) => s === 'SUBMITTED' || s === 'ACKNOWLEDGED'

const REVIEWER_TYPE: Record<string, string> = { SELF: 'Self review', MANAGER: 'Manager', PEER: 'Peer', SKIP_LEVEL: 'Manager’s manager', DIRECT_REPORT: 'Direct report' }
export const reviewerTypeLabel = (t?: string | null) => (t ? REVIEWER_TYPE[t] ?? t : null)

/**
 * "Kind words": what colleagues wrote under strengths in reviews about me that are
 * submitted (and so shown to me), newest first. Real review text, no kudos feature.
 */
export function kindWords(reviews: PerformanceReview[], me: string | undefined, limit = 3): { id: string; quote: string; who: string; date: string | null }[] {
  if (!me) return []
  return reviews
    .filter((r) => r.employeeId === me && r.reviewerId && r.reviewerId !== me && isSubmitted(r.status) && (r.strengths ?? '').trim())
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
    .slice(0, limit)
    .map((r) => ({ id: r.id, quote: (r.strengths ?? '').trim(), who: r.reviewerName || 'A colleague', date: r.submittedAt ? istDay(r.submittedAt) : null }))
}

// ── Cycles ──────────────────────────────────────────────────────────────────

/** The cycle the Review cycles card follows: the open one that started last, else the newest planned one. */
export function currentCycle(cycles: ReviewCycle[]): ReviewCycle | null {
  const by = (s: ReviewCycle['status']) => cycles.filter((c) => c.status === s)
    .sort((a, b) => (b.periodStart ?? b.createdAt ?? '').localeCompare(a.periodStart ?? a.createdAt ?? ''))[0]
  return by('ACTIVE') ?? by('DRAFT') ?? null
}

/** When an open cycle closes: the manager-review date, else the period end. */
export const closesOn = (c: { periodEnd?: string | null; milestones?: CycleMilestones | null }) => c.milestones?.managerReviewBy ?? c.periodEnd ?? null

export function cycleStatus(c: ReviewCycle, today: string): { label: string; tone: StatusTone } {
  if (c.status === 'CLOSED') return { label: 'Closed', tone: 'success' }
  if (c.status === 'DRAFT') return { label: 'Planned', tone: 'neutral' }
  const closes = closesOn(c)
  return { label: closes ? `Open · closes ${dayMon(closes, today).replace(/^\w+, /, '')}` : 'Open', tone: 'warning' }
}

/**
 * The cycle card's five steps (Goals set → Self review → Manager review → Calibration
 * → Shared) from real counts and dates. A step is done when its reviews are all in or
 * its date has passed; the first step not done is current. Calibration is a label
 * only (AUDIT §5.11): no step of its own in the data.
 */
export function cycleSteps(s: CycleStages, today: string): StepItem[] {
  const m = s.milestones
  const row = (type: string) => s.rows.find((r) => r.reviewerType === type)
  const self = row('SELF'), mgr = row('MANAGER')
  const past = (d?: string | null) => !!d && d < today
  const closed = s.status === 'CLOSED'
  const allIn = (r?: { total: number; submitted: number; missed: number }) => !!r && r.total > 0 && r.submitted + r.missed >= r.total
  const counts = (r?: { total: number; submitted: number }) => (r && r.total ? `${r.submitted} of ${r.total}` : 'Not assigned')
  const done = [
    s.status !== 'DRAFT' && (!m?.goalsBy || past(m.goalsBy)),
    closed || allIn(self) || (!self && s.status !== 'DRAFT') || past(m?.selfReviewBy),
    closed || allIn(mgr) || (!mgr && s.status !== 'DRAFT') || past(m?.managerReviewBy),
    !!m?.sharedAt || closed,
    !!m?.sharedAt,
  ]
  const metas = [
    m?.goalsBy ? `By ${dayMon(m.goalsBy, today)}` : 'At the start',
    self ? `${counts(self)} done` : 'Not assigned',
    mgr ? counts(mgr) : 'Not assigned',
    m?.managerReviewBy && m?.shareOn ? `${dayMon(m.managerReviewBy, today)} – ${dayMon(m.shareOn, today)}` : 'Before sharing',
    m?.sharedAt ? `Shared ${dayMon(istDay(m.sharedAt), today)}` : m?.shareOn ? `From ${dayMon(m.shareOn, today)}` : m?.holdUntilShared ? 'Held until shared' : 'As each one is submitted',
  ]
  const labels = ['Goals set', 'Self review', 'Manager review', 'Calibration', 'Shared']
  const current = done.findIndex((d) => !d)
  return labels.map((label, i) => ({ key: label, label, meta: metas[i], state: done[i] ? 'done' : i === current ? 'current' : 'todo' }))
}

/** My cycle card's four steps (EmpGrowth): goals, my self-review, my manager's review, shared with me. */
export function myCycleSteps(c: {
  milestones?: CycleMilestones | null; goals: number; goalsFirstSetAt?: string | null
  selfReview?: { status: ReviewStatus; submittedAt?: string | null } | null
  managerReview?: { status: ReviewStatus; reviewerName?: string | null; submittedAt?: string | null } | null
  feedbackHeld: boolean
}, today: string): StepItem[] {
  const m = c.milestones
  const selfDone = !!c.selfReview && isSubmitted(c.selfReview.status)
  const mgrDone = !!c.managerReview && isSubmitted(c.managerReview.status)
  const shown = mgrDone && !c.feedbackHeld
  const goalsDone = c.goals > 0 || selfDone
  const first = (c.managerReview?.reviewerName || '').split(' ')[0]
  const steps = [
    { label: 'Goals set', done: goalsDone, meta: c.goals > 0 ? `Done · ${c.goals} ${c.goals === 1 ? 'goal' : 'goals'}` : m?.goalsBy ? `By ${dayMon(m.goalsBy, today)}` : 'No goals yet' },
    { label: 'Your self-review', done: selfDone, meta: !c.selfReview ? 'Not assigned' : selfDone ? `Sent ${dayMon(istDay(c.selfReview.submittedAt ?? today), today)}` : m?.selfReviewBy ? `Due ${dayMon(m.selfReviewBy, today)}` : c.selfReview.status === 'IN_PROGRESS' ? 'Draft saved' : 'To write' },
    { label: first ? `${first}’s review` : 'Manager’s review', done: mgrDone, meta: !c.managerReview ? 'Not assigned' : mgrDone ? 'Done' : m?.managerReviewBy ? `By ${dayMon(m.managerReviewBy, today)}` : 'Waiting' },
    { label: 'Shared with you', done: shown, meta: shown ? 'You can read it' : m?.shareOn ? `By ${dayMon(m.shareOn, today)}` : c.feedbackHeld ? 'When HR shares it' : 'As soon as it’s written' },
  ]
  const current = steps.findIndex((s) => !s.done)
  return steps.map((s, i) => ({ key: s.label, label: s.label, meta: s.meta, state: s.done ? 'done' : i === current ? 'current' : 'todo' }))
}

// ── Goals ───────────────────────────────────────────────────────────────────

export function goalStatus(status: GoalStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'COMPLETED': return { label: 'Done', tone: 'brand' }
    case 'AT_RISK': return { label: 'Needs attention', tone: 'warning' }
    case 'DROPPED': return { label: 'Dropped', tone: 'muted' }
    default: return { label: 'On track', tone: 'success' }
  }
}

/** Admin wording for a goal's status (Goals & KPIs). */
export function kpiStatus(status?: string | null): { label: string; tone: StatusTone } {
  switch (status) {
    case 'COMPLETED': return { label: 'Completed', tone: 'success' }
    case 'AT_RISK': return { label: 'At risk', tone: 'danger' }
    case 'DROPPED': return { label: 'Dropped', tone: 'muted' }
    default: return { label: 'Active', tone: 'info' }
  }
}

// ── People ──────────────────────────────────────────────────────────────────

/** Reviewed / Review due / On probation (design), from the person's status and the open cycle. */
export function personStatus(p: { employmentStatus?: string | null; pendingInOpenCycle?: boolean; lastReviewStatus?: string | null }): { label: string; tone: StatusTone } {
  if (p.pendingInOpenCycle) return { label: 'Review due', tone: 'warning' }
  if (p.employmentStatus === 'PROBATION') return { label: 'On probation', tone: 'neutral' }
  if (p.employmentStatus === 'NOTICE_PERIOD') return { label: 'On notice', tone: 'amber' }
  if (p.lastReviewStatus === 'SUBMITTED' || p.lastReviewStatus === 'ACKNOWLEDGED') return { label: 'Reviewed', tone: 'success' }
  return { label: 'Not reviewed yet', tone: 'muted' }
}

// ── Learning ────────────────────────────────────────────────────────────────

/** Five skill words; the database keeps 1–5 (AUDIT §5.11). */
export const SKILL_WORDS: Record<number, string> = { 1: 'Beginner', 2: 'Basic', 3: 'Intermediate', 4: 'Advanced', 5: 'Expert' }
export const skillWord = (n?: number | null) => (n == null ? '—' : SKILL_WORDS[Math.max(1, Math.min(5, Math.round(n)))])
export const skillTone = (n?: number | null): StatusTone => (n == null ? 'muted' : n >= 4 ? 'success' : n === 3 ? 'info' : 'neutral')

export function certificationState(c: { status: string; daysLeft?: number | null }): { label: string; tone: StatusTone } {
  if (c.status === 'EXPIRED') return { label: 'Expired', tone: 'danger' }
  if (c.status === 'EXPIRING') {
    const n = c.daysLeft ?? 0
    return { label: n <= 0 ? 'Expires today' : `Expires in ${n} ${n === 1 ? 'day' : 'days'}`, tone: 'warning' }
  }
  return { label: 'Certified', tone: 'success' }
}

// ── Exit ────────────────────────────────────────────────────────────────────

/** Days from today to the last working day (negative when it has passed). */
export function daysLeft(lastWorkingDay: string | null | undefined, today: string): number | null {
  if (!lastWorkingDay) return null
  return Math.round((day(lastWorkingDay).getTime() - day(today).getTime()) / 86_400_000)
}

/**
 * A leaver's full & final, from their most recent settlement, with the F&F tab it opens
 * (FullAndFinal: pending-approval = PROCESSED, pending-payment = APPROVED, settled = PAID).
 */
export function fnfState(status: string | null | undefined): { label: string; tone: StatusTone; tab: string | null } {
  switch (status) {
    case 'INITIATED': return { label: 'Being prepared', tone: 'neutral', tab: 'all' }
    case 'PROCESSED': return { label: 'Waiting for approval', tone: 'warning', tab: 'pending-approval' }
    case 'APPROVED': return { label: 'Approved, to be paid', tone: 'info', tab: 'pending-payment' }
    case 'PAID': return { label: 'Settled', tone: 'success', tab: 'settled' }
    case 'CANCELLED': return { label: 'Cancelled', tone: 'muted', tab: 'all' }
    default: return { label: 'Not started', tone: 'muted', tab: null }
  }
}
