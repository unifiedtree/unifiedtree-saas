// Pieces shared by My goals, the review cards, the admin review drawer and the
// per-employee performance page. Built from the module kit only.
import { HrStatusPill, type PillTone } from '@/shared/components/hr'
import { Note, Row, RowList, State, SubHeading, dmy, stamp } from '@/design/module/ModuleKit'
import { useReviewGoals, type GoalProgressEntry, type ReviewGoal } from '../api/usePerformance'

export const GOAL_STATUS_TONE: Record<string, PillTone> = { ACTIVE: 'info', AT_RISK: 'warn', COMPLETED: 'ok', DROPPED: 'gray' }
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
 * is written (and in the admin review drawer). GET /v1/performance/reviews/{id}/goals.
 */
export function ReviewGoalsPanel({ reviewId, selfReview }: { reviewId: string; selfReview?: boolean }) {
  const q = useReviewGoals(reviewId)
  if (q.isLoading) return <State kind="loading" height={72} />
  if (q.isError) return <Note tone="red">{`Couldn’t load the goals for this review. ${(q.error as Error)?.message || ''}`.trim()}</Note>
  const data = q.data
  const goals: ReviewGoal[] = data?.goals ?? []
  const who = selfReview ? 'Your' : data?.employeeName ? `${data.employeeName}’s` : 'Their'
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <SubHeading>{`${who} goals & KPIs${data?.cycleName ? ` · ${data.cycleName}` : ''}`}</SubHeading>
      {goals.length === 0
        ? <Note>{selfReview ? 'You had no goals or KPIs set for this cycle.' : 'No goals or KPIs were set for this person in this cycle.'}</Note>
        : (
          <RowList>
            {goals.map((g) => (
              <Row key={g.id} title={g.title}
                meta={[goalMeasure(g), g.dueDate ? `due ${dmy(g.dueDate)}` : null, g.category].filter(Boolean).join(' · ')}
                trail={<>
                  {g.kpi && <HrStatusPill tone="purple">KPI</HrStatusPill>}
                  <HrStatusPill tone={GOAL_STATUS_TONE[g.status] || 'gray'}>{statusWords(g.status)}</HrStatusPill>
                </>} />
            ))}
          </RowList>
        )}
    </div>
  )
}

/** A goal's progress history: each update's value, when, who and the note. */
export function GoalHistoryList({ entries, kpi, unit }: { entries: GoalProgressEntry[]; kpi: boolean; unit?: string | null }) {
  if (!entries.length) return <Note>No progress updates recorded yet.</Note>
  const value = (v?: number | null) => (v == null ? '—' : kpi ? `${num(v)}${unit ? ` ${unit}` : ''}` : `${num(v)}%`)
  return (
    <RowList>
      {entries.map((e) => (
        <Row key={e.id}
          title={e.previousValue == null ? `Started at ${value(e.newValue)}` : `${value(e.previousValue)} → ${value(e.newValue)}`}
          meta={[stamp(e.updatedAt), e.updatedByName ? `by ${e.updatedByName}` : null, kpi ? `${Math.round(Number(e.progressPct ?? 0))}% of target` : null].filter(Boolean).join(' · ')}
          note={e.notes || undefined} />
      ))}
    </RowList>
  )
}
