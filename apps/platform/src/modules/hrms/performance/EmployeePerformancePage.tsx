// One person's performance (/hrms/performance/employees/:id), restyled on the redesign kit
// (no prototype screen; same blocks as before). GET /v1/performance/employees/{id}
// (hrms.performance.read): the person, their reviews, goals and KPIs, and their rating per
// cycle over time. HR and admin can open anyone; a department manager only their team (the
// API answers 403 for anyone else). Reached from Performance → People and from the
// Performance tab of the employee workspace.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, EmptyState, ErrorState, KeyValueGrid, MiniStat, MiniStatGrid, PageFrame, PageHeader, Section, SkeletonStats, StatusPill, Table,
  type TableColumn,
} from '@/design/kit/display'
import { SidePanel } from '@/design/kit/overlays'
import { stamp } from '@/design/module/ModuleKit'
import { TrendChart } from '../reports/ReportKit'
import { useEmployeePerformanceProfile, type EmployeeKpiRow, type ProfileReview } from '../api/usePerformance'
import { KpiDetails } from './KpisView'
import { ReviewGoalsPanel, goalMeasure, statusWords } from './shared'
import { dateLong, kpiStatus, periodLabel, ratingText, reviewStatus, reviewerTypeLabel } from './growModel'
import './grow.css'

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
  const reviewer = (r: ProfileReview) => (r.reviewerType === 'SELF' || !r.reviewerId || r.reviewerId === p?.employee.id
    ? 'Self review' : `${r.reviewerName || 'Reviewer'}${reviewerTypeLabel(r.reviewerType) ? ` · ${reviewerTypeLabel(r.reviewerType)}` : ''}`)

  const goalCols: TableColumn<EmployeeKpiRow>[] = [
    { key: 'title', header: 'Goal / KPI', primary: true, render: (g) => (
      <button type="button" className="grw-link" style={{ display: 'grid', gap: 2 }} onClick={() => setKpi(g)}>
        <span className="grw-strong">{g.title}</span>
        <span className="grw-muted">{[g.targetValue != null ? 'KPI' : 'Personal goal', g.category, g.dueDate ? `due ${dateLong(g.dueDate)}` : null].filter(Boolean).join(' · ')}</span>
      </button>
    ) },
    { key: 'measure', header: 'Progress', render: (g) => <span className="grw-num">{goalMeasure({ targetValue: g.targetValue, currentValue: g.currentValue, unit: g.unit, progressPct: g.progressPct })}</span> },
    { key: 'status', header: 'Status', render: (g) => <StatusPill tone={kpiStatus(g.status).tone}>{kpiStatus(g.status).label}</StatusPill> },
    { key: 'updated', header: 'Last update', render: (g) => (g.updatedAt ? stamp(g.updatedAt) : '—') },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (g) => <CellActions><Button variant="secondary" size={30} onClick={() => setKpi(g)}>History</Button></CellActions> },
  ]
  const reviewCols: TableColumn<ProfileReview>[] = [
    { key: 'cycle', header: 'Cycle', primary: true, render: (r) => <span className="grw-strong">{r.cycleName || 'Review cycle'}</span> },
    { key: 'reviewer', header: 'Reviewer', render: reviewer },
    { key: 'rating', header: 'Rating', render: (r) => <span className="grw-num">{r.overallRating == null ? 'Not submitted' : rating(r.overallRating)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={reviewStatus(r.status).tone}>{reviewStatus(r.status).label}</StatusPill> },
    { key: 'submitted', header: 'Submitted', render: (r) => (r.submittedAt ? dateLong(r.submittedAt.slice(0, 10)) : '—') },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => <CellActions><Button variant="secondary" size={30} onClick={() => setReview(r)}>View review</Button></CellActions> },
  ]

  return (
    <PageFrame label="Performance" className="grw-page">
      <PageHeader eyebrow="Performance" title={p ? `${p.employee.name || 'Employee'}’s performance` : 'Performance'}
        sub={p ? [p.employee.employeeCode, p.employee.designation, p.employee.department].filter(Boolean).join(' · ') || undefined : undefined}
        actions={<>
          <Button variant="secondary" icon="chevronLeft" onClick={() => navigate('/hrms/performance?view=people')}>People</Button>
          {canOpenRecord && p && <Button variant="secondary" onClick={() => navigate(`/hrms/employees/${id}`)}>Open employee record</Button>}
        </>} />
      {q.isLoading ? <SkeletonStats />
        : status === 403 ? <EmptyState icon="lock" title="Not in your team" hint="You can open the performance of people in your own team only." />
          : status === 404 ? <EmptyState icon="users" title="Employee not found" hint="They may have been removed from this workspace." />
            : q.isError || !p ? <ErrorState title="Couldn’t load this person’s performance" error={q.error} onRetry={() => q.refetch()} />
              : (
                <>
                  <Section title="Summary">
                    <MiniStatGrid>
                      <MiniStat label="Latest rating" countUp={false} value={rating(p.summary.latestRating)} note={p.ratings.length ? (p.ratings[p.ratings.length - 1].cycleName || 'Latest cycle') : 'Not rated yet'} tone="success" />
                      <MiniStat label="Average rating" countUp={false} value={rating(p.summary.averageRating)} note={`Across ${p.summary.reviewsSubmitted} submitted ${p.summary.reviewsSubmitted === 1 ? 'review' : 'reviews'}`} tone="info" />
                      <MiniStat label="Active goals" value={p.summary.activeGoals} note={`${p.summary.atRiskGoals} at risk · ${p.summary.completedGoals} completed`} tone="neutral" />
                      <MiniStat label="Reviews waiting" value={p.summary.reviewsPending} note="Not submitted yet" tone="warning" />
                    </MiniStatGrid>
                  </Section>
                  <Section title="About">
                    <KeyValueGrid items={[
                      { label: 'Department', value: p.employee.department || '—' },
                      { label: 'Designation', value: p.employee.designation || '—' },
                      { label: 'Manager', value: p.employee.managerName || '—' },
                      { label: 'Joined', value: p.employee.dateOfJoining ? dateLong(p.employee.dateOfJoining) : '—' },
                      { label: 'Status', value: statusWords(p.employee.employmentStatus) || (p.employee.active ? 'Active' : 'Inactive') },
                    ]} />
                    {!p.employee.active && <div style={{ marginTop: 12 }}><Callout tone="warning">This person is no longer active. Their record is kept for reference.</Callout></div>}
                  </Section>
                  <Section title="Ratings over time" sub="Average of the submitted reviews in each cycle, out of 5"
                    empty={p.ratings.length === 0 ? { title: 'No submitted reviews yet', hint: 'Ratings appear here once a review cycle’s reviews are submitted.', icon: 'chart' } : undefined}>
                    {p.ratings.length > 0 && (
                      <TrendChart unit="" points={p.ratings.map((r, i) => ({ key: r.cycleId || String(i), short: (r.cycleName || `Cycle ${i + 1}`).slice(0, 14), value: Number(r.averageRating) }))}
                        readout={(i) => {
                          const r = p.ratings[i]
                          return <>
                            <strong style={{ fontSize: 13.5, fontWeight: 500 }}>{r.cycleName || 'Review cycle'}</strong>
                            <span style={{ fontSize: 13 }}>{`${ratingText(r.averageRating)} · ${r.reviewCount} ${r.reviewCount === 1 ? 'review' : 'reviews'}`}</span>
                            {r.periodStart && <span className="grw-muted">{periodLabel(r.periodStart, r.periodEnd)}</span>}
                          </>
                        }} />
                    )}
                  </Section>
                  <Section title="Goals & KPIs" count={p.goals.length} body="flush">
                    <Table label="Goals and KPIs" columns={goalCols} rows={p.goals} rowKey={(g) => g.id} mobile="cards"
                      empty={<EmptyState variant="plain" icon="target" title="No goals or KPIs set for this person yet." />} />
                  </Section>
                  <Section title="Reviews" count={p.reviews.length} body="flush">
                    <Table label="Reviews" columns={reviewCols} rows={p.reviews} rowKey={(r) => r.id} mobile="cards"
                      empty={<EmptyState variant="plain" icon="clipboard" title="No reviews for this person yet." />} />
                  </Section>
                </>
              )}
      {kpi && <KpiDetails initial={kpi} canWrite={canWriteKpi || canTeamProgress} canManage={canManageKpi} onClose={() => { setKpi(null); void q.refetch() }} />}
      {review && p && (
        <SidePanel open onClose={() => setReview(null)} title="Review" width={560} sub={`${review.cycleName || 'Review cycle'} · ${reviewer(review)}`}>
          <div className="grw-stack">
            <div className="grw-row grw-row--between">
              <span className="grw-strong">{p.employee.name || 'Employee'}</span>
              <StatusPill tone={reviewStatus(review.status).tone}>{reviewStatus(review.status).label}</StatusPill>
            </div>
            <KeyValueGrid items={[
              { label: 'Overall rating', value: review.overallRating == null ? 'Not submitted' : ratingText(review.overallRating) },
              { label: 'Strengths', value: review.strengths || 'No feedback submitted.' },
              { label: 'Areas to improve', value: review.improvements || 'No feedback submitted.' },
              { label: 'Submitted', value: review.submittedAt ? stamp(review.submittedAt) : '—' },
            ]} />
            <ReviewGoalsPanel reviewId={review.id} />
          </div>
        </SidePanel>
      )}
    </PageFrame>
  )
}
