// Present days, late days, average hours and recorded overtime per person, in
// the Workforce Analytics design's report layout (ReportKit). Overtime is
// shown as recorded minutes: it is approval-only and isn't paid through payroll.
import { useAttendanceSummaryReport } from '@/modules/hrms/api/useReports'
import { StatusPill } from '@/design/kit/display'
import { stackedBarsSvg } from '@/shared/export/charts'
import { useReportCompany } from './useReportCompany'
import { useReportRange, ReportRangeFilter, monthStartIso, longDate, ReportPage, KpiRow, KPI_ICON, ReportSection, BarsChart, ReportTable, downloadChart, num, sortKey, slug, type Kpi } from './ReportKit'

const long = longDate
const hm = (mins: number) => (mins ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '—')
const SERIES: [string, string][] = [['On time', 'var(--u-br,#0F6E56)'], ['Late', 'var(--u-g2,#5FB39C)']]

export function AttendanceSummaryReport() {
  const co = useReportCompany()
  const { from, to, setRange, TODAY } = useReportRange(monthStartIso())
  const q = useAttendanceSummaryReport(co.company || null, from, to)

  const rows = (q.data ?? []).map((r) => ({
    id: r.employee_code, code: r.employee_code, name: r.employee_name, dept: r.department || 'No department', none: !r.department,
    present: Number(r.present_days) || 0, late: Number(r.late_days) || 0, hours: r.avg_hours == null ? null : Number(r.avg_hours), ot: Number(r.total_overtime_mins) || 0,
  }))
  type Row = (typeof rows)[number]
  const present = rows.reduce((a, r) => a + r.present, 0), late = rows.reduce((a, r) => a + r.late, 0), ot = rows.reduce((a, r) => a + r.ot, 0)
  const withHours = rows.filter((r) => r.hours != null), avgHours = withHours.length ? withHours.reduce((a, r) => a + (r.hours || 0), 0) / withHours.length : null
  const depts = [...rows.reduce((m, r) => { const d = m.get(r.dept) || { dept: r.dept, none: r.none, onTime: 0, late: 0 }; d.onTime += Math.max(0, r.present - r.late); d.late += r.late; m.set(r.dept, d); return m }, new Map<string, { dept: string; none: boolean; onTime: number; late: number }>()).values()]
    .sort((a, b) => (a.none ? 1 : b.none ? -1 : b.onTime + b.late - (a.onTime + a.late)))
  const state = q.isLoading ? 'loading' : q.error ? 'error' : rows.length ? 'live' : 'empty'
  const range = `${long(from)} – ${long(to)}`

  const kpis: Kpi[] = [
    { label: 'People', value: num(rows.length), sub: `${num(present)} days present in all`, color: 'blue', icon: KPI_ICON.users },
    { label: 'Average present days', value: rows.length ? (present / rows.length).toFixed(1) : '—', sub: range, color: 'green', icon: KPI_ICON.calendar },
    { label: 'Late days', value: num(late), sub: present ? `${Math.round((late / present) * 100)}% of present days` : 'No days present', color: 'orange', icon: KPI_ICON.alarm },
    { label: 'Overtime recorded', value: hm(ot), sub: 'Approval-only, not paid', color: 'purple', icon: KPI_ICON.timer },
  ]
  const fileBase = `attendance-summary-${slug(co.companyName)}-${from}_${to}`
  const chart = () => stackedBarsSvg({ title: 'Present days by department', subtitle: `${co.companyName} · ${range}`, bars: depts.map((d) => ({ label: d.dept, parts: [d.onTime, d.late] })), series: SERIES })
  const HEAD = ['Code', 'Name', 'Department', 'Present days', 'Late days', 'Avg hours', 'Overtime (min, recorded)']
  const table = () => rows.map((r) => [r.code, r.name, r.dept, r.present, r.late, r.hours == null ? null : Number(r.hours.toFixed(2)), r.ot])

  return (
    <ReportPage title="Attendance summary" subtitle="Present days, late days, average hours and recorded overtime per person" report="attendance-summary" co={co} skeleton="bars"
      filters={<ReportRangeFilter from={from} to={to} max={TODAY} onChange={setRange} />}
      note={range}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: { from, to },
        sheets: () => [{ name: 'Summary', widths: [26, 34], rows: [['Attendance summary', ''], ['Company', co.companyName], ['Range', range], ...kpis.map((k) => [k.label, k.value])] }, { name: 'People', widths: [12, 26, 22, 13, 10, 10, 22], rows: [HEAD, ...table()] }],
      }}>
      <KpiRow items={kpis} />
      <ReportSection title="Present days by department" legend={SERIES}
        onDownload={() => downloadChart(`attendance-by-department-${slug(co.companyName)}-${from}_${to}.png`, chart(), { report: 'attendance-summary', companyId: co.company, filters: { from, to } })}>
        <BarsChart series={SERIES} unit="days" bars={depts.map((d) => ({ key: d.dept, label: d.dept, none: d.none, parts: [d.onTime, d.late] }))} />
      </ReportSection>
      <ReportTable<Row & { sP: string; sL: string; sH: string; sO: string }>
        title="People" subtitle="Overtime is recorded for approval; it isn’t paid through payroll"
        search={{ placeholder: 'Search name, code or department…', match: (r, s) => `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(s) }}
        rows={rows.map((r) => ({ ...r, sP: sortKey(r.present), sL: sortKey(r.late), sH: sortKey(r.hours ?? -1), sO: sortKey(r.ot) }))}
        columns={[
          { key: 'name', header: 'Employee', sortable: true, render: (r) => <span><span>{r.name}</span><span className="rp-code">{r.code}</span></span> },
          { key: 'dept', header: 'Department', sortable: true, render: (r) => <span className={r.none ? 'rp-italic' : undefined}>{r.dept}</span> },
          { key: 'sP', header: 'Present', sortable: true, render: (r) => <b>{num(r.present)}</b> },
          { key: 'sL', header: 'Late', sortable: true, render: (r) => (r.late ? <StatusPill tone="warning">{num(r.late)}</StatusPill> : <span className="rp-muted">0</span>) },
          { key: 'sH', header: 'Avg hours', sortable: true, render: (r) => (r.hours == null ? '—' : r.hours.toFixed(1)) },
          { key: 'sO', header: 'Overtime', sortable: true, render: (r) => hm(r.ot) },
        ]}
        footerCells={['Total', '', num(present), num(late), avgHours == null ? '—' : `${avgHours.toFixed(1)} avg`, hm(ot)]}
      />
    </ReportPage>
  )
}
