// Pieces shared by My goals, the review panels and the per-employee performance page,
// on the redesign kit (tokens only).
import { Callout, ListRow, ListRows, SkeletonList, StatusPill, type StatusTone } from '@/design/kit/display'
import { stamp } from '@/design/module/ModuleKit'
import { useReviewGoals, type GoalProgressEntry, type ReviewGoal } from '../api/usePerformance'
import { dayMon, kpiStatus } from './growModel'

export const GOAL_STATUS_TONE: Record<string, StatusTone> = { ACTIVE: 'info', AT_RISK: 'warning', COMPLETED: 'success', DROPPED: 'muted' }
/** "AT_RISK" → "At risk" */
export const statusWords = (v?: string | null) => (v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const num = (n?: number | null) => (n == null ? '0' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))

/** "40 of 100 tasks · 40%" for a KPI, "40% done" for a personal goal. */
export function goalMeasure(g: { kpi?: boolean; targetValue?: number | null; currentValue?: number | null; unit?: string | null; progressPct?: number | null }) {
  const pct = Math.round(Number(g.progressPct ?? 0))
  return g.kpi || g.targetValue != null
    ? `${num(g.currentValue)} of ${num(g.targetValue)}${g.unit ? ` ${g.unit}` : ''} · ${pct}%`
    : `${pct}% done`
}

/**
 * The reviewee's goals and KPIs for the review's cycle, shown while the review
 * is written (and in the admin review panel). GET /v1/performance/reviews/{id}/goals.
 */
export function ReviewGoalsPanel({ reviewId, selfReview }: { reviewId: string; selfReview?: boolean }) {
  const q = useReviewGoals(reviewId)
  if (q.isLoading) return <SkeletonList rows={2} />
  if (q.isError) return <Callout tone="danger">{`Couldn’t load the goals for this review. ${(q.error as Error)?.message || ''}`.trim()}</Callout>
  const data = q.data
  const goals: ReviewGoal[] = data?.goals ?? []
  const who = selfReview ? 'Your' : data?.employeeName ? `${data.employeeName}’s` : 'Their'
  return (
    <div className="grw-stack grw-stack--tight">
      <h3 className="grw-sub">{`${who} goals & KPIs${data?.cycleName ? ` · ${data.cycleName}` : ''}`}</h3>
      {goals.length === 0
        ? <Callout tone="neutral">{selfReview ? 'You had no goals or KPIs set for this cycle.' : 'No goals or KPIs were set for this person in this cycle.'}</Callout>
        : (
          <ListRows>
            {goals.map((g) => (
              <ListRow key={g.id} variant="divided" density="compact" title={g.title}
                sub={[goalMeasure(g), g.dueDate ? `due ${dayMon(g.dueDate)}` : null, g.category].filter(Boolean).join(' · ')}
                end={<span className="grw-row">
                  {g.kpi && <StatusPill tone="holiday" size="sm">KPI</StatusPill>}
                  <StatusPill tone={kpiStatus(g.status).tone} size="sm">{kpiStatus(g.status).label}</StatusPill>
                </span>} />
            ))}
          </ListRows>
        )}
    </div>
  )
}

/** A goal's progress history: each update's value, when, who and the note. */
export function GoalHistoryList({ entries, kpi, unit }: { entries: GoalProgressEntry[]; kpi: boolean; unit?: string | null }) {
  if (!entries.length) return <p className="grw-muted" style={{ margin: 0 }}>No progress updates recorded yet.</p>
  const value = (v?: number | null) => (v == null ? '—' : kpi ? `${num(v)}${unit ? ` ${unit}` : ''}` : `${num(v)}%`)
  return (
    <ListRows>
      {entries.map((e) => (
        <ListRow key={e.id} variant="divided" density="compact"
          title={e.previousValue == null ? `Started at ${value(e.newValue)}` : `${value(e.previousValue)} → ${value(e.newValue)}`}
          sub={[stamp(e.updatedAt), e.updatedByName ? `by ${e.updatedByName}` : null, kpi ? `${Math.round(Number(e.progressPct ?? 0))}% of target` : null].filter(Boolean).join(' · ')}
          meta={e.notes || undefined} />
      ))}
    </ListRows>
  )
}
