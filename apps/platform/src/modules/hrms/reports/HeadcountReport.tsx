// Headcount by department on any date, in the Workforce Analytics design's
// report layout (ReportKit). A department opens in the Workforce Directory.
import { useSearchParams, useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrStatusPill } from '@/shared/components/hr'
import { useHeadcountReport } from '@/modules/hrms/api/useReports'
import { stackedBarsSvg } from '@/shared/export/charts'
import { useReportCompany } from './useReportCompany'
import { todayIso, longDate, ReportPage, KpiRow, KPI_ICON, ReportSection, BarsChart, ReportTable, DateFilter, downloadChart, num, pctOf, sortKey, slug, type Kpi } from './ReportKit'

const SERIES: [string, string][] = [['Active', '#0f6e56'], ['On notice', '#34d399'], ['Probation', '#a7f3d0']]
const long = longDate

export function HeadcountReport() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const co = useReportCompany()
  const canDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const TODAY = todayIso()
  const asOf = params.get('asOf') ?? TODAY
  const setAsOf = (v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('asOf', v); return n }, { replace: true })
  const q = useHeadcountReport(co.company || null, asOf)

  const raw = q.data ?? []
  const rows = [...raw.filter((r) => r.department).sort((a, b) => b.total - a.total), ...raw.filter((r) => !r.department)].map((r) => ({
    id: r.department_id || '__none', deptId: r.department_id ?? null, dept: r.department || 'No department', none: !r.department,
    total: Number(r.total) || 0, active: Number(r.active) || 0, notice: Number(r.on_notice) || 0, probation: Number(r.probation) || 0,
  }))
  type Row = (typeof rows)[number]
  const t = rows.reduce((a, r) => ({ total: a.total + r.total, active: a.active + r.active, notice: a.notice + r.notice, probation: a.probation + r.probation }), { total: 0, active: 0, notice: 0, probation: 0 })
  // "No department" opens the people without one (departmentId=none).
  const open = canDirectory ? (r: Row) => navigate(`/hrms/employees?co=${co.company}&departmentId=${r.deptId || 'none'}`) : undefined
  const state = q.isLoading ? 'loading' : q.error ? 'error' : rows.length ? 'live' : 'empty'
  const named = rows.filter((r) => !r.none).length

  const kpis: Kpi[] = [
    { label: 'Total headcount', value: num(t.total), sub: `${named} ${named === 1 ? 'department' : 'departments'}`, color: 'blue', icon: KPI_ICON.users },
    { label: 'Active', value: num(t.active), sub: `${pctOf(t.active, t.total)}% of headcount`, color: 'green', icon: KPI_ICON.check },
    { label: 'On notice', value: num(t.notice), sub: `${pctOf(t.notice, t.total)}% of headcount`, color: 'orange', icon: KPI_ICON.hourglass },
    { label: 'On probation', value: num(t.probation), sub: `${pctOf(t.probation, t.total)}% of headcount`, color: 'teal', icon: KPI_ICON.calendar },
  ]
  const fileBase = `headcount-${slug(co.companyName)}-${asOf}`
  const chart = () => stackedBarsSvg({ title: 'Headcount by department', subtitle: `${co.companyName} · as of ${long(asOf)}`, bars: rows.map((r) => ({ label: r.dept, parts: [r.active, r.notice, r.probation] })), series: SERIES })
  const table = (): (string | number)[][] => rows.map((r) => [r.dept, r.total, r.active, r.notice, r.probation, pctOf(r.total, t.total)])
  const HEAD = ['Department', 'Total', 'Active', 'On notice', 'Probation', 'Share %']
  const pill = (v: number, tone: string) => (v ? <HrStatusPill tone={tone as any}>{num(v)}</HrStatusPill> : <span style={{ color: '#94a3b8' }}>0</span>)
  const share = (v: number) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><b style={{ minWidth: 32 }}>{pctOf(v, t.total)}%</b>
      <span style={{ width: 64, height: 6, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', display: 'inline-block' }}><span style={{ display: 'block', height: '100%', width: `${t.total ? (v / t.total) * 100 : 0}%`, background: '#0f6e56' }} /></span></span>
  )

  return (
    <ReportPage title="Headcount Report" subtitle="Active, probation and notice-period headcount by department, on any date" report="headcount" co={co}
      filters={<DateFilter label="As of" value={asOf} max={TODAY} onChange={setAsOf} />} note={`Data as of ${long(asOf)}`}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: { asOf },
        sheets: () => [{ name: 'Summary', widths: [26, 30], rows: [['Headcount report', ''], ['Company', co.companyName], ['As of', long(asOf)], ...kpis.map((k) => [k.label, k.value])] }, { name: 'Departments', widths: [28, 10, 10, 12, 12, 10], rows: [HEAD, ...table(), ['Total', t.total, t.active, t.notice, t.probation, 100]] }],
      }}>
      <KpiRow items={kpis} />
      <ReportSection title="Headcount by department" pill={<HrStatusPill tone="green">{`${named} ${named === 1 ? 'dept' : 'depts'}`}</HrStatusPill>} legend={SERIES}
        onDownload={() => downloadChart(`headcount-by-department-${slug(co.companyName)}-${asOf}.png`, chart(), { report: 'headcount', companyId: co.company, filters: { asOf } })}>
        <BarsChart series={SERIES} footnote="Click to open in directory"
          bars={rows.map((r) => ({ key: r.id, label: r.dept, none: r.none, parts: [r.active, r.notice, r.probation], onClick: open ? () => open(r) : undefined, hint: open ? (r.none ? 'Open the people without a department' : `Open ${r.dept} in the directory`) : undefined }))} />
      </ReportSection>
      <ReportTable<Row & { sT: string; sA: string; sN: string; sP: string }>
        title="Departments" subtitle={open ? 'Click a department to open it in the Workforce Directory' : undefined}
        rows={rows.map((r) => ({ ...r, sT: sortKey(r.total), sA: sortKey(r.active), sN: sortKey(r.notice), sP: sortKey(r.probation) }))}
        onRowClick={open}
        columns={[
          { key: 'dept', header: 'Department', sortable: true, render: (r) => <span style={{ fontWeight: 700, color: r.none ? '#64748b' : '#0f6e56', fontStyle: r.none ? 'italic' : 'normal' }}>{r.dept}</span> },
          { key: 'sT', header: 'Total', sortable: true, render: (r) => <b>{num(r.total)}</b> },
          { key: 'sA', header: 'Active', sortable: true, render: (r) => num(r.active) },
          { key: 'sN', header: 'On notice', sortable: true, render: (r) => pill(r.notice, 'orange') },
          { key: 'sP', header: 'Probation', sortable: true, render: (r) => pill(r.probation, 'blue') },
          { key: 'share', header: 'Share', render: (r) => share(r.total) },
        ]}
        footerCells={['Total', num(t.total), num(t.active), num(t.notice), num(t.probation), '100%']}
        card={(r) => ({ title: r.dept, muted: r.none, big: num(r.total), small: `${pctOf(r.total, t.total)}%`, stats: [['Active', num(r.active)], ['On notice', num(r.notice)], ['Probation', num(r.probation)]] })}
      />
    </ReportPage>
  )
}
