// Attendance analytics · Punctuality (prototype PgTime a-analytics tab 1; BW-21): who is often late, and when, from
// effective late days. Team-scoped on the server (a manager sees their team), so it works without the company report.
// An empty table says "No late marks" only when people came in (checkIns, from the page's month data); a month with
// no check-ins says so instead of "everyone came in on time".
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { CellPerson, EmptyState, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { usePunctuality, type PunctualityRow } from '../../api/useAttendanceInsights'
import { lateTrend, monthLabel, monthName, noLateMarks, weekdayPlural } from './analyticsModel'

export function PunctualityView({ m, checkIns = null }: { m: { month: string; past: boolean; from: string; to: string }; checkIns?: number | null }) {
  const navigate = useNavigate()
  const canOpenPeople = usePermission(P.HRMS_EMPLOYEE_READ)
  const q = usePunctuality(m.from, m.to)
  const prevName = q.data ? monthName(q.data.previousFrom) : 'last month'
  const columns: TableColumn<PunctualityRow>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.employeeName || 'Employee'} sub={r.departmentName || r.employeeCode || undefined} /> },
    { key: 'late', header: 'Late marks', numeric: true, render: (r) => <span className="apl-num">{r.lateDays}</span> },
    { key: 'delay', header: 'Avg delay', render: (r) => <span className="apl-num">{r.avgDelayMinutes == null ? '—' : `${Math.round(r.avgDelayMinutes)} min`}</span> },
    { key: 'worst', header: 'Worst day', render: (r) => weekdayPlural(r.worstWeekday) ?? '—' },
    {
      key: 'trend', header: 'Trend', render: (r) => {
        const t = lateTrend(r.lateDays, r.previousLateDays)
        return <StatusPill tone={t.tone} title={`${r.previousLateDays} late ${r.previousLateDays === 1 ? 'mark' : 'marks'} in ${prevName}`}>{t.label}</StatusPill>
      },
    },
  ]
  if (q.notAvailable) {
    return <EmptyState icon="clock" title="Punctuality isn’t available yet" hint="It shows here once the server is updated. Late marks are in the Overview meanwhile." />
  }
  const rows = q.data?.rows ?? []
  const none = noLateMarks(checkIns, m.past)
  return (
    <Section title={m.past ? `Most late marks in ${monthLabel(m.from)}` : 'Most late marks this month'} body="flush"
      sub={q.data ? `${q.data.totals.lateDays} late ${q.data.totals.lateDays === 1 ? 'mark' : 'marks'} · ${q.data.totals.people} ${q.data.totals.people === 1 ? 'person' : 'people'} · ${q.data.totals.previousLateDays} in ${prevName}` : undefined}
      error={q.error} onRetry={() => q.refetch()}>
      <Table label="Most late marks" columns={columns} rows={rows} rowKey={(r) => r.employeeId} loading={q.isLoading} mobile="cards"
        empty={<EmptyState variant={none.success ? 'success' : 'plain'} icon="clock" title={none.title} hint={none.hint} />}
        onRowClick={canOpenPeople ? (r) => navigate(`/hrms/employees/${r.employeeId}`) : undefined}
        rowLabel={canOpenPeople ? (r) => `Open ${r.employeeName || 'employee'}` : undefined} />
    </Section>
  )
}
