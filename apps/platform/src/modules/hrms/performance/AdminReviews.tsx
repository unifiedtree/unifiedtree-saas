import { useState } from 'react'
import { HrAvatar, HrButton, HrDrawer, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { DataTable } from '@/shared/components/DataTable'
import { useReviewCycles, useReviews, type PerformanceReview } from '../api/usePerformance'
import { PerformanceError } from './PerformanceEmployeePicker'

const tone: Record<string, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal', MISSED: 'red' }
export function AdminReviews() {
  const cycles = useReviewCycles()
  const [cycleId, setCycleId] = useState('')
  const [page, setPage] = useState(0)
  const reviews = useReviews(cycleId || undefined, page)
  const [selected, setSelected] = useState<PerformanceReview | null>(null)
  useClampedPage(page, reviews.data?.totalPages, setPage)
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">Employee reviews</h2><p className="mt-1 text-sm text-text-secondary">Read submitted feedback and track pending reviews. Assign reviewers from Review cycles.</p></div>
    <label className="block max-w-sm text-xs font-medium text-text-secondary">Review cycle<select className="ut-select mt-1" value={cycleId} onChange={e => { setCycleId(e.target.value); setPage(0) }}><option value="">All cycles</option>{cycles.data?.map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
    {cycles.isError && <PerformanceError error={cycles.error} retry={() => cycles.refetch()} />}
    {reviews.isError ? <PerformanceError error={reviews.error} retry={() => reviews.refetch()} /> : <TableCard footer={<HrPagination page={page} pageSize={20} totalElements={reviews.data?.totalElements ?? 0} totalPages={reviews.data?.totalPages ?? 0} onPageChange={setPage} />}><DataTable<PerformanceReview> data={reviews.data?.content ?? []} keyField="id" loading={reviews.isLoading} emptyMessage="No employee reviews in this selection." columns={[
      { key: 'employee', header: 'Employee', render: review => <HrAvatar name={review.employeeName || 'Employee'} sub={review.employeeCode || review.employeeId} /> },
      { key: 'reviewer', header: 'Reviewer', render: review => <span>{review.reviewerName || (review.reviewerId ? review.reviewerId : 'Self review')}</span> },
      { key: 'cycle', header: 'Cycle', render: review => <span>{review.cycleName || cycles.data?.find(cycle => cycle.id === review.cycleId)?.name || 'Review cycle'}</span> },
      { key: 'rating', header: 'Rating', render: review => <span className="font-semibold tabular-nums">{review.overallRating == null ? 'Not submitted' : `${review.overallRating} / 5`}</span> },
      { key: 'status', header: 'Status', render: review => <HrStatusPill tone={tone[review.status] || 'gray'}>{review.status.toLowerCase().replaceAll('_', ' ')}</HrStatusPill> },
      { key: 'action', header: 'Details', render: review => <HrButton size="sm" variant="ghost" onClick={() => setSelected(review)}>View review</HrButton> },
    ]} /></TableCard>}
    {selected && <HrDrawer title="Employee review" onClose={() => setSelected(null)}><div className="space-y-5"><HrAvatar name={selected.employeeName || 'Employee'} sub={selected.employeeCode || selected.employeeId} /><div><p className="text-xs text-text-secondary">Review cycle</p><p className="mt-1 font-semibold">{selected.cycleName || cycles.data?.find(cycle => cycle.id === selected.cycleId)?.name || 'Review cycle'}</p></div><HrStatusPill tone={tone[selected.status] || 'gray'}>{selected.status.toLowerCase().replaceAll('_', ' ')}</HrStatusPill><div className="rounded-lg bg-[#E6F4F1] p-4"><p className="text-xs text-text-secondary">Overall rating</p><p className="mt-1 text-xl font-semibold text-[#0A5240]">{selected.overallRating == null ? 'Not submitted' : `${selected.overallRating} / 5`}</p></div><div><h4 className="font-semibold">Strengths</h4><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{selected.strengths || 'No feedback submitted.'}</p></div><div><h4 className="font-semibold">Areas to improve</h4><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{selected.improvements || 'No feedback submitted.'}</p></div>{selected.submittedAt && <p className="text-xs text-text-secondary">Submitted {new Date(selected.submittedAt).toLocaleString('en-IN')}</p>}</div></HrDrawer>}
  </div>
}
