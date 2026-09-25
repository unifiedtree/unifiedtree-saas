// One person's performance (/hrms/performance/employees/:id).
// GET /v1/performance/employees/{id} (hrms.performance.read): the person, their
// reviews, goals and KPIs, and their rating per cycle over time. HR and admin can
// open anyone; a department manager only their team (the API answers 403 for
// anyone else). Reached from Performance → People and from the Performance tab
// of the employee workspace.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrAvatar, HrButton, HrDrawer, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { ModulePage, StatRow, State, SubHeading, Facts, Note, dmy, stamp } from '@/design/module/ModuleKit'
import { ReportSection, TrendChart } from '../reports/ReportKit'
import { useEmployeePerformanceProfile, type EmployeeKpiRow, type ProfileReview } from '../api/usePerformance'
import { KpiDetails } from './AdminKpis'
import { GOAL_STATUS_TONE, ReviewGoalsPanel, goalMeasure, statusWords } from './shared'

const REVIEW_TONE: Record<string, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal', MISSED: 'red' }
const REVIEWER: Record<string, string> = { SELF: 'Self review', MANAGER: 'Manager', PEER: 'Peer', SUBORDINATE: 'Direct report', SKIP_LEVEL: 'Skip-level manager' }
const rating = (v?: number | null) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })} / 5`)

export function EmployeePerformancePage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const canOpenRecord = usePermission(P.HRMS_EMPLOYEE_READ)
  const canWriteKpi = usePermission('hrms.performance.write')
  const canTeamProgress = usePermission('hrms.kpi.progress')
  const canManageKpi = usePermission('hrms.kpi.manage')
  const q = useEmployeePerformanceProfile(id)
  const [kpi, setKpi] = useState<EmployeeKpiRow | null>(null)
  const [review, setReview] = useState<ProfileReview | null>(null)
  const p = q.data
  const status = (q.error as { status?: number } | null)?.status
  const back = <HrButton variant="ghost" onClick={() => navigate('/hrms/performance?view=people')}>← People</HrButton>
  const record = canOpenRecord && p ? <HrButton variant="ghost" onClick={() => navigate(`/hrms/employees/${id}`)}>Open employee record</HrButton> : null
  return (
    <ModulePage crumb="Performance" title={p ? `${p.employee.name || 'Employee'}’s performance` : 'Performance'}
      subtitle={p ? [p.employee.employeeCode, p.employee.designation, p.employee.department].filter(Boolean).join(' · ') || undefined : undefined}
      actions={<>{back}{record}</>}>
      {q.isLoading ? <State kind="loading" height={260} />
        : status === 403 ? <State kind="empty" icon="lock" title="Not in your team" description="You can open the performance of people in your own team only." />
          : status === 404 ? <State kind="empty" icon="users" title="Employee not found" description="They may have been removed from this workspace." />
            : q.isError || !p ? <State kind="error" title="Couldn’t load this person’s performance" description={(q.error as Error)?.message} onRetry={() => q.refetch()} />
              : (
                <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                  <StatRow tiles={[
                    { icon: 'target', color: 'green', label: 'Latest rating', value: rating(p.summary.latestRating), sub: p.ratings.length ? (p.ratings[p.ratings.length - 1].cycleName || 'Latest cycle') : 'Not rated yet' },
                    { icon: 'chart', color: 'blue', label: 'Average rating', value: rating(p.summary.averageRating), sub: `Across ${p.summary.reviewsSubmitted} submitted ${p.summary.reviewsSubmitted === 1 ? 'review' : 'reviews'}` },
                    { icon: 'checkCircle', color: 'teal', label: 'Active goals', value: String(p.summary.activeGoals), sub: `${p.summary.atRiskGoals} at risk · ${p.summary.completedGoals} completed` },
                    { icon: 'clipboard', color: 'orange', label: 'Reviews waiting', value: String(p.summary.reviewsPending), sub: 'Not submitted yet' },
                  ]} />
                  <Facts items={[
                    { k: 'Department', v: p.employee.department || '—' },
                    { k: 'Designation', v: p.employee.designation || '—' },
                    { k: 'Manager', v: p.employee.managerName || '—' },
                    { k: 'Joined', v: dmy(p.employee.dateOfJoining) },
                    { k: 'Status', v: statusWords(p.employee.employmentStatus) || (p.employee.active ? 'Active' : 'Inactive') },
                  ]} />
                  {!p.employee.active && <Note tone="amber">This person is no longer active. Their record is kept for reference.</Note>}

                  <ReportSection title="Ratings over time" pill={<span style={{ fontSize: 12, color: '#64748b' }}>Average of the submitted reviews in each cycle, out of 5</span>}>
                    {p.ratings.length === 0
                      ? <Note>No submitted reviews yet. Ratings appear here once a review cycle’s reviews are submitted.</Note>
                      : <TrendChart unit="" points={p.ratings.map((r, i) => ({ key: r.cycleId || String(i), short: (r.cycleName || `Cycle ${i + 1}`).slice(0, 14), value: Number(r.averageRating) }))}
                        readout={(i) => {
                          const r = p.ratings[i]
                          return <>
                            <strong style={{ fontSize: 13.5 }}>{r.cycleName || 'Review cycle'}</strong>
                            <span style={{ fontSize: 13, color: '#334155' }}>{`${rating(r.averageRating)} · ${r.reviewCount} ${r.reviewCount === 1 ? 'review' : 'reviews'}`}</span>
                            {r.periodStart && <span style={{ fontSize: 12.5, color: '#64748b' }}>{`${dmy(r.periodStart)}${r.periodEnd ? ` – ${dmy(r.periodEnd)}` : ''}`}</span>}
                          </>
                        }} />}
                  </ReportSection>

                  <SubHeading>{`Goals & KPIs · ${p.goals.length}`}</SubHeading>
                  <TableCard>
                    <DataTable<EmployeeKpiRow> data={p.goals} keyField="id" emptyMessage="No goals or KPIs set for this person yet."
                      columns={[
                        { key: 'title', header: 'Goal / KPI', render: (g) => <button type="button" className="max-w-xs text-left font-semibold text-[#0F6E56] hover:underline" onClick={() => setKpi(g)}>{g.title}<span className="mt-1 block text-xs font-normal text-text-secondary">{[g.targetValue != null ? 'KPI' : 'Personal goal', g.category, g.dueDate ? `due ${dmy(g.dueDate)}` : null].filter(Boolean).join(' · ')}</span></button> },
                        { key: 'measure', header: 'Progress', render: (g) => <span className="whitespace-nowrap tabular-nums">{goalMeasure({ targetValue: g.targetValue, currentValue: g.currentValue, unit: g.unit, progressPct: g.progressPct })}</span> },
                        { key: 'status', header: 'Status', render: (g) => <HrStatusPill tone={GOAL_STATUS_TONE[g.status || 'ACTIVE'] || 'gray'}>{statusWords(g.status || 'ACTIVE')}</HrStatusPill> },
                        { key: 'updated', header: 'Last update', render: (g) => <span className="text-text-secondary">{g.updatedAt ? stamp(g.updatedAt) : '—'}</span> },
                        { key: 'history', header: 'Details', render: (g) => <HrButton size="sm" variant="ghost" onClick={() => setKpi(g)}>History</HrButton> },
                      ]} />
                  </TableCard>

                  <SubHeading>{`Reviews · ${p.reviews.length}`}</SubHeading>
                  <TableCard>
                    <DataTable<ProfileReview> data={p.reviews} keyField="id" emptyMessage="No reviews for this person yet."
                      columns={[
                        { key: 'cycle', header: 'Cycle', render: (r) => <span className="font-semibold">{r.cycleName || 'Review cycle'}</span> },
                        { key: 'reviewer', header: 'Reviewer', render: (r) => <span>{r.reviewerType === 'SELF' || (!r.reviewerId || r.reviewerId === p.employee.id) ? 'Self review' : `${r.reviewerName || 'Reviewer'}${r.reviewerType && REVIEWER[r.reviewerType] ? ` · ${REVIEWER[r.reviewerType]}` : ''}`}</span> },
                        { key: 'rating', header: 'Rating', render: (r) => <span className="font-semibold tabular-nums">{r.overallRating == null ? 'Not submitted' : rating(r.overallRating)}</span> },
                        { key: 'status', header: 'Status', render: (r) => <HrStatusPill tone={REVIEW_TONE[r.status] || 'gray'}>{statusWords(r.status)}</HrStatusPill> },
                        { key: 'submitted', header: 'Submitted', render: (r) => <span className="text-text-secondary">{r.submittedAt ? dmy(r.submittedAt) : '—'}</span> },
                        { key: 'view', header: 'Details', render: (r) => <HrButton size="sm" variant="ghost" onClick={() => setReview(r)}>View review</HrButton> },
                      ]} />
                  </TableCard>
                </div>
              )}
      {kpi && <KpiDetails initial={kpi} canWrite={canWriteKpi || canTeamProgress} canManage={canManageKpi} onClose={() => { setKpi(null); void q.refetch() }} />}
      {review && p && (
        <HrDrawer title="Review" onClose={() => setReview(null)}>
          <div className="space-y-5">
            <HrAvatar name={p.employee.name || 'Employee'} sub={p.employee.employeeCode || undefined} />
            <div><p className="text-xs text-text-secondary">Review cycle</p><p className="mt-1 font-semibold">{review.cycleName || 'Review cycle'}</p></div>
            <HrStatusPill tone={REVIEW_TONE[review.status] || 'gray'}>{statusWords(review.status)}</HrStatusPill>
            <div className="rounded-lg bg-[#E6F4F1] p-4"><p className="text-xs text-text-secondary">Overall rating</p><p className="mt-1 text-xl font-semibold text-[#0A5240]">{review.overallRating == null ? 'Not submitted' : rating(review.overallRating)}</p></div>
            <div><h4 className="font-semibold">Strengths</h4><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{review.strengths || 'No feedback submitted.'}</p></div>
            <div><h4 className="font-semibold">Areas to improve</h4><p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{review.improvements || 'No feedback submitted.'}</p></div>
            <ReviewGoalsPanel reviewId={review.id} />
            {review.submittedAt && <p className="text-xs text-text-secondary">Submitted {stamp(review.submittedAt)}</p>}
          </div>
        </HrDrawer>
      )}
    </ModulePage>
  )
}
