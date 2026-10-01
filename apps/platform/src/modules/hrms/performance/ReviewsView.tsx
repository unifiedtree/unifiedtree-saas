// Performance · Employee reviews (PgGrow p-center tab 1): every review with a status filter
// (All · Waiting · Submitted, server-side, BW-81), the cycle filter, the reviewee's department
// and the reviewer type. Waiting reviews can be reminded (a real notification, once a day,
// BW-80); submitted ones open in a side panel with the reviewee's goals for the cycle.
// Managers (no performance.write) see their team; the API scopes the list.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, CellPerson, EmptyState, KeyValueGrid, Section, SegmentedControl, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Select, SidePanel, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useReviewCycles, useReviews, type PerformanceReview } from '../api/usePerformance'
import { useRemindReview } from '../api/usePerformanceAdmin'
import { dayMon, isSubmitted, isWaiting, ratingText, reviewStatus, reviewerTypeLabel } from './growModel'
import { ReviewGoalsPanel } from './shared'

type Seg = 'all' | 'WAITING' | 'SUBMITTED'

export function ReviewsView() {
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const canWrite = usePermission('hrms.performance.write')
  const cycles = useReviewCycles()
  const [cycleId, setCycleId] = useState('')
  const [seg, setSeg] = useState<Seg>('all')
  const [page, setPage] = useState(0)
  const reviews = useReviews(cycleId || undefined, page, true, seg === 'all' ? undefined : seg)
  const remind = useRemindReview()
  const [reminding, setReminding] = useState<string | null>(null)
  const [selected, setSelected] = useState<PerformanceReview | null>(null)
  const cycleName = (r: PerformanceReview) => r.cycleName || cycles.data?.find((c) => c.id === r.cycleId)?.name || 'Review cycle'
  const reviewer = (r: PerformanceReview) => (r.reviewerType === 'SELF' || !r.reviewerId || r.reviewerId === r.employeeId ? 'Self review' : r.reviewerName || 'Reviewer')

  const onRemind = async (r: PerformanceReview) => {
    setReminding(r.id)
    try {
      await remind.mutateAsync(r.id)
      toast.success(`Reminder sent to ${reviewer(r) === 'Self review' ? r.employeeName || 'them' : reviewer(r)}`)
    } catch (e) {
      toast.error('Couldn’t send the reminder', { detail: errorText(e, 'Try again in a moment.') })
    } finally { setReminding(null) }
  }

  const columns: TableColumn<PerformanceReview>[] = [
    { key: 'employee', header: 'Employee', primary: true, render: (r) => (
      <button type="button" className="grw-link" style={{ color: 'inherit' }} title="Open their performance page" onClick={() => navigate(`/hrms/performance/employees/${r.employeeId}`)}>
        <CellPerson name={r.employeeName || 'Employee'} sub={r.department || r.employeeCode || undefined} />
      </button>
    ) },
    { key: 'cycle', header: 'Cycle', render: (r) => cycleName(r) },
    { key: 'reviewer', header: 'Reviewer', render: (r) => (
      <span style={{ display: 'grid' }}><span>{reviewer(r)}</span>{r.reviewerType && r.reviewerType !== 'SELF' && <span className="grw-muted">{reviewerTypeLabel(r.reviewerType)}</span>}</span>
    ) },
    { key: 'rating', header: 'Rating', render: (r) => <span className="grw-num">{r.overallRating == null ? (isWaiting(r.status) && r.dueDate ? `Due ${dayMon(r.dueDate, today)}` : '—') : `${r.overallRating}`}</span> },
    { key: 'status', header: 'Status', render: (r) => { const s = reviewStatus(r.status); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
      <CellActions>
        {isWaiting(r.status) && canWrite && <Button variant="secondary" size={30} loading={reminding === r.id} disabled={!!reminding} onClick={() => onRemind(r)}>Remind</Button>}
        {!isWaiting(r.status) && <Button variant="soft" size={30} aria-label="View review" onClick={() => setSelected(r)}>Open</Button>}
      </CellActions>
    ) },
  ]
  const data = reviews.data
  return (
    <>
      {!canWrite && <Callout tone="neutral">You see your team: everyone in the departments you head, or your direct reports if you don’t head one. Your own reviews are under My reviews.</Callout>}
      <Section title="Employee reviews" body="flush" error={reviews.error ?? cycles.error} onRetry={() => { void reviews.refetch(); void cycles.refetch() }}
        actions={(
          <div className="grw-filters" style={{ justifyContent: 'flex-end' }}>
            <SegmentedControl label="Review status" size="sm" value={seg} onChange={(v) => { setSeg(v); setPage(0) }}
              options={[{ value: 'all', label: 'All' }, { value: 'WAITING', label: 'Waiting' }, { value: 'SUBMITTED', label: 'Submitted' }]} />
            <div className="grw-filters__fixed">
              <Select label="Review cycle" value={cycleId} onChange={(e) => { setCycleId(e.target.value); setPage(0) }}
                options={[{ value: '', label: 'All cycles' }, ...(cycles.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            </div>
          </div>
        )}
        footer={data && data.totalPages > 1 ? <Pager page={page} pageSize={20} total={data.totalElements} onPageChange={setPage} noun="reviews" /> : undefined}>
        <Table label="Employee reviews" columns={columns} rows={data?.content ?? []} rowKey={(r) => r.id} loading={reviews.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="clipboard" title={seg === 'all' && !cycleId ? 'No reviews yet' : 'No reviews in this selection'} hint="When a review cycle starts, reviews appear here." />} />
      </Section>
      {selected && (
        <SidePanel open onClose={() => setSelected(null)} title={`Review · ${selected.employeeName || 'Employee'}`} width={560}
          sub={`${cycleName(selected)} · by ${reviewer(selected)}`}>
          <div className="grw-stack">
            <div className="grw-row grw-row--between">
              <CellPerson name={selected.employeeName || 'Employee'} sub={selected.department || selected.employeeCode || undefined} />
              <StatusPill tone={reviewStatus(selected.status).tone}>{reviewStatus(selected.status).label}</StatusPill>
            </div>
            <Section title={isSubmitted(selected.status) ? 'Reviews and feedback' : 'Not submitted'} level={3} cardClass={false} variant="panel">
              <KeyValueGrid items={[
                { label: 'Rating', value: selected.overallRating == null ? 'Not submitted' : ratingText(selected.overallRating) },
                { label: 'Strengths', value: selected.strengths || 'No feedback submitted.' },
                { label: 'Areas to improve', value: selected.improvements || 'No feedback submitted.' },
                { label: 'Submitted', value: selected.submittedAt ? dayMon(selected.submittedAt.slice(0, 10), today) : '—' },
              ]} />
            </Section>
            {selected.status === 'MISSED' && <Callout tone="warning">The cycle closed before this review was submitted.</Callout>}
            <ReviewGoalsPanel reviewId={selected.id} />
          </div>
        </SidePanel>
      )}
    </>
  )
}
