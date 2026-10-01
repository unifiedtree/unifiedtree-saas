// Workforce analytics (/hrms/workforce-analytics), prototype PgSetup "r-wfa": three
// views in the URL (?tab=headcount|attrition|diversity), each only with its own
// report permission, as inline pill tabs (DECISIONS 21).
//   Headcount: the figures on a date (?asOf=), people by department (a department
//     opens the directory), the month-end headcount for the last six months
//     (/v1/reports/headcount/trend) and the departments table.
//   Attrition: a period (?period=: this financial year from /v1/reports/fiscal-year,
//     the last 12 months, the year so far or last calendar year), exits, the
//     annualised rate, the split, exits per month and the monthly trend.
//   Diversity: today's gender split company-wide and women by department.
// Download per view: its Excel workbook, its report's PDF and raw CSV from the
// server, plus the whole-page snapshot PDF; chart PNGs. Every file is recorded
// in the workspace's export log. Every number comes from the report APIs.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  BarList, Button, Card, ColumnChart, EmptyState, ErrorState, MiniStat, MiniStatGrid, PageFrame, PageHeader, PillTabs, Section, SkeletonChart,
  SkeletonStats, StatusPill, Table, type TableColumn,
} from '@/design/kit/display'
import { Select, useToast } from '@/design/kit/overlays'
import { apiBlob } from '@/core/api/client'
import { useAttritionReport, useDiversityReport, useFiscalYear, useHeadcountReport, useHeadcountTrend, type AttritionRow } from '@/modules/hrms/api/useReports'
import { csvBlob, saveAndRecord, saveServerFile, svgToPng, xlsxBlob, type Cell, type Sheet } from '@/shared/export/fileExport'
import { stackedBarsSvg } from '@/shared/export/charts'
import { useReportCompany, slug } from '@/modules/hrms/reports/useReportCompany'
import { CompanyFilter, DateFilter, ExportMenu, SERIES_COLORS } from '@/modules/hrms/reports/ReportKit'
import '@/modules/hrms/reports/reports.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const longDate = (s: string) => { const d = parse(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}` }
const monthShort = (ym: string) => MON[Number(ym.split('-')[1]) - 1]
const num = (n: number) => Number(n || 0).toLocaleString('en-IN')
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

const TABS = [
  { key: 'headcount', label: 'Headcount', sub: 'Active, probation and notice-period people by department, on any date.' },
  { key: 'attrition', label: 'Attrition', sub: 'Monthly exits split into resigned, terminated and other, with the attrition rate.' },
  { key: 'diversity', label: 'Diversity', sub: 'Gender split of the current workforce, company-wide and by department.' },
] as const
type Tab = typeof TABS[number]['key']

/** The attrition periods; "fy" needs the company's fiscal year from the server. */
function periodsFor(today: Date, fy: { from: string; label: string } | undefined) {
  const y = today.getFullYear(), t = iso(today)
  return [
    ...(fy ? [{ value: 'fy', label: `This financial year (${fy.label})`, short: 'This financial year', from: fy.from, to: t }] : []),
    { value: 'l12', label: 'Last 12 months', short: 'Last 12 months', from: iso(new Date(y, today.getMonth() - 11, 1)), to: t },
    { value: 'ytd', label: `${y} so far`, short: `${y} so far`, from: `${y}-01-01`, to: t },
    { value: `y${y - 1}`, label: `Calendar ${y - 1}`, short: `Calendar ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ]
}

interface Dept { id: string | null; dept: string; none: boolean; total: number; active: number; notice: number; probation: number }

export function WorkforceAnalytics() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const canHead = usePermission(P.HRMS_REPORT_HEADCOUNT), canDiv = usePermission(P.HRMS_REPORT_DIVERSITY), canAttr = usePermission(P.HRMS_REPORT_ATTRITION)
  const canDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const co = useReportCompany()
  const company = co.company || null
  const today = useMemo(() => new Date(), [])
  const todayIso = iso(today)

  const tabs = TABS.filter((t) => (t.key === 'headcount' ? canHead : t.key === 'attrition' ? canAttr : canDiv))
  const tab: Tab | undefined = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]?.key
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const rawAsOf = params.get('asOf') || ''
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) && rawAsOf <= todayIso ? rawAsOf : todayIso
  const fy = useFiscalYear(company, { enabled: canAttr && tab === 'attrition' })
  const periods = periodsFor(today, fy.data)
  const period = periods.find((p) => p.value === params.get('period')) ?? (fy.isLoading ? null : periods[0])

  const head = useHeadcountReport(company, asOf, { enabled: canHead && tab === 'headcount' })
  const trend = useHeadcountTrend(company, 6, asOf === todayIso ? null : asOf, { enabled: canHead && tab === 'headcount' })
  const attr = useAttritionReport(company, period?.from ?? '', period?.to ?? '', { enabled: canAttr && tab === 'attrition' && !!period })
  const div = useDiversityReport(company, { enabled: canDiv && tab === 'diversity' })
  const [busy, setBusy] = useState(false)

  // ── data ──
  const depts: Dept[] = useMemo(() => {
    const rows = (head.data ?? []).map((r) => ({ id: r.department_id ?? null, dept: r.department || 'No department', none: !r.department, total: Number(r.total) || 0, active: Number(r.active) || 0, notice: Number(r.on_notice) || 0, probation: Number(r.probation) || 0 }))
    return [...rows.filter((r) => !r.none).sort((a, b) => b.total - a.total), ...rows.filter((r) => r.none)]
  }, [head.data])
  const t = depts.reduce((a, r) => ({ total: a.total + r.total, active: a.active + r.active, notice: a.notice + r.notice, probation: a.probation + r.probation }), { total: 0, active: 0, notice: 0, probation: 0 })
  const months = (attr.data ?? []).map((r: AttritionRow) => ({ m: r.month, label: monthLabel(r.month), short: monthShort(r.month), exits: Number(r.exits) || 0, resign: Number(r.resignations) || 0, term: Number(r.terminations) || 0, other: Number(r.other_exits) || 0, headcount: Number(r.headcount) || 0, pct: Number(r.attrition_pct) || 0 }))
  const ex = months.reduce((a, m) => ({ exits: a.exits + m.exits, resign: a.resign + m.resign, term: a.term + m.term, other: a.other + m.other }), { exits: 0, resign: 0, term: 0, other: 0 })
  const avgHead = months.length ? months.reduce((a, m) => a + m.headcount, 0) / months.length : 0
  /** Exits over the average month-end headcount, scaled to a year. */
  const annualised = months.length && avgHead ? (ex.exits / avgHead) * (12 / months.length) * 100 : 0
  const range = months.length ? (months[0].m.slice(0, 4) === months[months.length - 1].m.slice(0, 4)
    ? `${MONTHS[Number(months[0].m.slice(5)) - 1]} – ${MONTHS[Number(months[months.length - 1].m.slice(5)) - 1]} ${months[0].m.slice(0, 4)}`
    : `${monthLabel(months[0].m)} – ${monthLabel(months[months.length - 1].m)}`) : ''
  const gender = useMemo(() => {
    const total = { women: 0, men: 0, other: 0 }, byDept = new Map<string, { id: string | null; dept: string; women: number; all: number }>()
    for (const r of div.data ?? []) {
      const n = Number(r.count) || 0, k = r.gender === 'FEMALE' ? 'women' : r.gender === 'MALE' ? 'men' : 'other'
      total[k] += n
      const key = r.department_id || ''
      const g = byDept.get(key) || { id: r.department_id ?? null, dept: r.department || 'No department', women: 0, all: 0 }
      g.all += n; if (k === 'women') g.women += n
      byDept.set(key, g)
    }
    return { total, all: total.women + total.men + total.other, byDept: [...byDept.values()].filter((g) => g.all > 0).sort((a, b) => pctOf(b.women, b.all) - pctOf(a.women, a.all)) }
  }, [div.data])

  // ── navigation ──
  const openDept = (r: { id: string | null }) => navigate(`/hrms/employees?co=${co.company}&departmentId=${r.id || 'none'}`)

  // ── downloads ──
  const run = async (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try { toast.success(await fn()) } catch (e) { toast.error(e instanceof Error && e.message ? e.message : 'Could not export the report') } finally { setBusy(false) }
  }
  const base = `workforce-analytics-${slug(co.companyName)}`
  const meta = (fmt: 'CSV' | 'XLSX' | 'PNG', filters: Record<string, string>, rows?: number) => ({ report: 'workforce-analytics' as const, fmt, companyId: co.company, filters, rows })
  const server = (path: string, q: Record<string, string>, file: string) => run(async () => {
    // apiBlob, not a link: the route needs the bearer token and tenant header.
    saveServerFile(file, await apiBlob(`${path}?${new URLSearchParams({ companyId: co.company, ...q })}`))
    return `${file} downloaded`
  })
  const png = (file: string, chart: { svg: string; width: number; height: number }, filters: Record<string, string>) => run(async () => {
    saveAndRecord(file, await svgToPng(chart.svg, chart.width, chart.height), meta('PNG', filters))
    return `${file} downloaded`
  })
  const deptRows = (): Cell[][] => [['Department', 'Total', 'Active', 'On notice', 'Probation', 'Share %'], ...depts.map((r) => [r.dept, r.total, r.active, r.notice, r.probation, pctOf(r.total, t.total)]), ['Total', t.total, t.active, t.notice, t.probation, 100]]
  const snapshotFrom = period?.from ?? iso(new Date(today.getFullYear(), today.getMonth() - 11, 1))
  const snapshot = { key: 'snapshot', label: 'Dashboard snapshot (PDF)', sub: 'Every view you can see, made on the server', run: () => server('/v1/reports/workforce-analytics/export.pdf', { from: snapshotFrom, to: todayIso }, `${base}.pdf`) }
  const headChart = () => stackedBarsSvg({ title: 'Headcount by department', subtitle: `${co.companyName} · as of ${longDate(asOf)}`, bars: depts.map((r) => ({ label: r.dept, parts: [r.active, r.notice, r.probation] })), series: [['Active', SERIES_COLORS.a], ['On notice', SERIES_COLORS.b], ['Probation', SERIES_COLORS.c]] })
  const trendChart = () => stackedBarsSvg({ title: 'Headcount · last 6 months', subtitle: co.companyName, bars: (trend.data ?? []).map((p) => ({ label: monthLabel(p.month), parts: [p.headcount] })), series: [['Headcount', SERIES_COLORS.a]] })
  const exitsChart = () => stackedBarsSvg({ title: 'Exits per month', subtitle: `${co.companyName} · ${range}`, bars: months.map((m) => ({ label: m.label, parts: [m.resign, m.term, m.other] })), series: [['Resigned', SERIES_COLORS.a], ['Terminated', SERIES_COLORS.b], ['Other', SERIES_COLORS.c]] })

  const items = tab === 'headcount' && head.data ? [
    { key: 'xlsx', label: 'Headcount workbook (.xlsx)', sub: 'Figures, departments and the 6-month trend', run: () => run(async () => {
      const sheets: Sheet[] = [
        { name: 'Summary', widths: [28, 34], rows: [['Workforce analytics · Headcount', ''], ['Company', co.companyName], ['As of', longDate(asOf)], ['Headcount', t.total], ['Active', t.active], ['Probation', t.probation], ['On notice', t.notice]] },
        { name: 'Departments', widths: [28, 10, 10, 12, 12, 10], rows: deptRows() },
        ...(trend.data ? [{ name: 'Last 6 months', widths: [14, 14, 12], rows: [['Month', 'As of', 'Headcount'], ...trend.data.map((p) => [monthLabel(p.month), longDate(p.asOf), p.headcount] as Cell[])] }] : []),
      ]
      const file = `${base}-headcount-${asOf}.xlsx`
      saveAndRecord(file, xlsxBlob(sheets), meta('XLSX', { tab: 'headcount', asOf }, depts.length))
      return `${file} downloaded`
    }) },
    { key: 'csv', label: 'Departments (CSV)', sub: 'The departments table as raw rows', run: () => run(async () => {
      const file = `${base}-departments.csv`
      saveAndRecord(file, csvBlob(deptRows()), meta('CSV', { tab: 'headcount', asOf }, depts.length))
      return `${file} downloaded`
    }) },
    { key: 'pdf', label: 'Headcount report (PDF)', sub: 'Made on the server, as of the same date', run: () => server('/v1/reports/headcount/export.pdf', { asOf }, `headcount-${slug(co.companyName)}-${asOf}.pdf`) },
    { key: 'raw', label: 'Raw rows (CSV)', sub: 'Straight from the server, same date', run: () => server('/v1/reports/headcount/export.csv', { asOf }, `headcount-${slug(co.companyName)}-${asOf}.csv`) },
    snapshot,
  ] : tab === 'attrition' && attr.data && period ? [
    { key: 'xlsx', label: 'Attrition workbook (.xlsx)', sub: 'Figures and the monthly trend', run: () => run(async () => {
      const sheets: Sheet[] = [
        { name: 'Summary', widths: [28, 34], rows: [['Workforce analytics · Attrition', ''], ['Company', co.companyName], ['Period', `${period.short} (${range})`], ['Exits', ex.exits], ['Attrition rate (annualised)', `${annualised.toFixed(1)}%`], ['Resigned', ex.resign], ['Terminated', ex.term], ['Other', ex.other]] },
        { name: 'Monthly trend', widths: [12, 8, 10, 11, 8, 11, 12], rows: [['Month', 'Exits', 'Resigned', 'Terminated', 'Other', 'Headcount', 'Attrition %'], ...months.map((m) => [m.label, m.exits, m.resign, m.term, m.other, m.headcount, m.pct] as Cell[])] },
      ]
      const file = `${base}-attrition-${period.value}.xlsx`
      saveAndRecord(file, xlsxBlob(sheets), meta('XLSX', { tab: 'attrition', period: period.short, from: period.from, to: period.to }, months.length))
      return `${file} downloaded`
    }) },
    { key: 'pdf', label: 'Attrition report (PDF)', sub: 'Made on the server, same period', run: () => server('/v1/reports/attrition/export.pdf', { from: period.from, to: period.to }, `attrition-${slug(co.companyName)}-${period.from}_${period.to}.pdf`) },
    { key: 'raw', label: 'Raw rows (CSV)', sub: 'Straight from the server, same period', run: () => server('/v1/reports/attrition/export.csv', { from: period.from, to: period.to }, `attrition-${slug(co.companyName)}-${period.from}_${period.to}.csv`) },
    snapshot,
  ] : tab === 'diversity' && div.data ? [
    { key: 'xlsx', label: 'Diversity workbook (.xlsx)', sub: 'Company-wide and by department', run: () => run(async () => {
      const sheets: Sheet[] = [
        { name: 'Summary', widths: [28, 34], rows: [['Workforce analytics · Diversity', ''], ['Company', co.companyName], ['As of', longDate(todayIso)], ['Women', gender.total.women], ['Men', gender.total.men], ['Other or not said', gender.total.other]] },
        { name: 'By department', widths: [28, 10, 10, 10], rows: [['Department', 'Women', 'People', 'Women %'], ...gender.byDept.map((g) => [g.dept, g.women, g.all, pctOf(g.women, g.all)] as Cell[])] },
      ]
      const file = `${base}-diversity-${todayIso}.xlsx`
      saveAndRecord(file, xlsxBlob(sheets), meta('XLSX', { tab: 'diversity', asOf: todayIso }, gender.byDept.length))
      return `${file} downloaded`
    }) },
    { key: 'pdf', label: 'Diversity report (PDF)', sub: 'Made on the server', run: () => server('/v1/reports/diversity/export.pdf', {}, `diversity-${slug(co.companyName)}-${todayIso}.pdf`) },
    { key: 'raw', label: 'Raw rows (CSV)', sub: 'Straight from the server', run: () => server('/v1/reports/diversity/export.csv', {}, `diversity-${slug(co.companyName)}-${todayIso}.csv`) },
    snapshot,
  ] : []

  if (!tabs.length || !tab) {
    return (
      <PageFrame label="Workforce analytics">
        <PageHeader eyebrow="Reports" title="Workforce analytics" />
        <Card><EmptyState icon="lock" title="Access restricted" hint="You do not have the required permissions to view this page." /></Card>
      </PageFrame>
    )
  }
  const sub = TABS.find((x) => x.key === tab)!.sub
  const q = tab === 'headcount' ? head : tab === 'attrition' ? attr : div
  const noCo = !co.loading && !co.company
  const loading = !noCo && (co.loading || q.isLoading || (tab === 'attrition' && !period))
  const dow = parse(asOf)

  return (
    <PageFrame label="Workforce analytics" className="rp-page">
      <PageHeader eyebrow="Reports" title="Workforce analytics" sub={sub} actions={<ExportMenu busy={busy} items={items} label="Download" primary />} />
      <PillTabs label="Workforce analytics views" semantics="tabs" activeKey={tab} onSelect={(k) => setParam('tab', k)} items={tabs.map((x) => ({ key: x.key, label: x.label }))} />
      <div className="rp-filters">
        <CompanyFilter co={co} />
        {tab === 'headcount' && <DateFilter label="As of" value={asOf} max={todayIso} onChange={(v) => setParam('asOf', v === todayIso ? null : v)} />}
        {tab === 'attrition' && period && (
          <div style={{ flex: '0 1 250px', minWidth: 0 }}>
            <Select aria-label="Period" size="md" value={period.value} options={periods.map((p) => ({ value: p.value, label: p.label }))} onChange={(e) => setParam('period', e.target.value)} />
          </div>
        )}
        <span className="rp-note">{tab === 'attrition' ? (range ? `Showing ${range}` : '') : `Data as of ${longDate(tab === 'headcount' ? asOf : todayIso)}`}</span>
      </div>

      {noCo ? <Card><EmptyState icon="building" variant="dashed" title="Select a company" hint="Choose a company from the filter above to load the analytics." /></Card>
        : q.error ? <Card><ErrorState title="Failed to load analytics" error={q.error} onRetry={() => q.refetch()} /></Card>
          : loading ? <div role="status" aria-label="Loading analytics" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><SkeletonStats /><Card><SkeletonChart /></Card></div>
            : tab === 'headcount' ? (
              <>
                <Section title={`On ${DOW[dow.getDay()]}, ${longDate(asOf)}`} rise>
                  <MiniStatGrid>
                    <MiniStat label="Headcount" value={num(t.total)} note="Everyone on the rolls" tone="info" countUp={false} />
                    <MiniStat label="Active" value={num(t.active)} note="Confirmed" tone="success" countUp={false} />
                    <MiniStat label="Probation" value={num(t.probation)} tone="warning" countUp={false} />
                    <MiniStat label="On notice" value={num(t.notice)} tone="danger" countUp={false} />
                  </MiniStatGrid>
                </Section>
                <div className="rp-row">
                  <Section title="By department" rise empty={depts.length ? false : { title: 'No records for this date.' }}
                    actions={depts.length ? <Button variant="secondary" size={32} icon="download" aria-label="Download chart as PNG" title="Download chart as PNG" onClick={() => png(`headcount-by-department-${slug(co.companyName)}-${asOf}.png`, headChart(), { tab: 'headcount', asOf })} /> : undefined}>
                    <BarList label="Headcount by department" labelWidth="minmax(90px,150px)" valueWidth={48}
                      items={depts.map((r) => ({
                        key: r.id ?? 'none', label: r.none ? <span className="rp-italic">{r.dept}</span> : r.dept, value: num(r.total), amount: r.total,
                        onClick: canDirectory ? () => openDept(r) : undefined,
                        title: canDirectory ? (r.none ? 'Open the people without a department in the directory' : `Open ${r.dept} in the directory`) : `${r.dept}: ${r.total}`,
                      }))} />
                  </Section>
                  {!trend.notAvailable && (
                    <Section title="Headcount · last 6 months" rise loading={trend.isLoading} skeleton="chart" error={trend.error} onRetry={() => trend.refetch()}
                      actions={trend.data?.length ? <Button variant="secondary" size={32} icon="download" aria-label="Download trend as PNG" title="Download trend as PNG" onClick={() => png(`headcount-last-6-months-${slug(co.companyName)}.png`, trendChart(), { tab: 'headcount', asOf })} /> : undefined}>
                      {trend.data && <ColumnChart label="Headcount · last 6 months" legend={[{ label: 'Headcount', tone: 'brand' }]}
                        bars={trend.data.map((p) => ({ key: p.month, label: monthShort(p.month), value: num(p.headcount), amount: p.headcount, tip: `${monthLabel(p.month)}: ${p.headcount} people on ${longDate(p.asOf)}` }))} />}
                    </Section>
                  )}
                </div>
                {depts.length > 0 && (
                  <Section title="Departments" sub={canDirectory ? 'Click a department to open it in the Workforce Directory' : 'Headcount by department'} body="flush" rise>
                    <Table<Dept> label="Departments" mobile="cards" minWidth={560} rowKey={(r) => r.id ?? 'none'} rows={depts}
                      onRowClick={canDirectory ? (r) => openDept(r) : undefined}
                      columns={[
                        { key: 'dept', header: 'Department', primary: true, render: (r) => <span className={r.none ? 'rp-italic' : 'rp-brand'}>{r.dept}</span> },
                        { key: 'total', header: 'Total', numeric: true, render: (r) => num(r.total) },
                        { key: 'active', header: 'Active', numeric: true, render: (r) => num(r.active) },
                        { key: 'notice', header: 'On notice', numeric: true, render: (r) => (r.notice ? <StatusPill tone="warning" size="xs">{num(r.notice)}</StatusPill> : <span className="rp-muted">0</span>) },
                        { key: 'probation', header: 'Probation', numeric: true, render: (r) => (r.probation ? <StatusPill tone="info" size="xs">{num(r.probation)}</StatusPill> : <span className="rp-muted">0</span>) },
                        { key: 'share', header: 'Share', render: (r) => <span className="rp-share"><b>{pctOf(r.total, t.total)}%</b><span className="rp-share__track"><span className="rp-share__fill" style={{ width: `${pctOf(r.total, t.total)}%` }} /></span></span> },
                      ] as TableColumn<Dept>[]} />
                  </Section>
                )}
              </>
            ) : tab === 'attrition' ? (
              <>
                <Section title={range || period?.short || ''} rise>
                  <MiniStatGrid>
                    <MiniStat label="Exits" value={num(ex.exits)} note={period?.short} tone="neutral" countUp={false} />
                    <MiniStat label="Attrition rate" value={`${annualised.toFixed(1)}%`} note="Annualised" tone="warning" countUp={false} />
                    <MiniStat label="Resigned" value={num(ex.resign)} tone="info" countUp={false} />
                    <MiniStat label="Terminated" value={num(ex.term)} tone="danger" countUp={false} />
                    <MiniStat label="Other" value={num(ex.other)} note="Retirement, absconding and other exits" tone="neutral" countUp={false} />
                  </MiniStatGrid>
                </Section>
                <div className="rp-row">
                  <Section title="Exits per month" rise
                    actions={months.length ? <Button variant="secondary" size={32} icon="download" aria-label="Download chart as PNG" title="Download chart as PNG" onClick={() => png(`exits-per-month-${slug(co.companyName)}-${period?.value}.png`, exitsChart(), { tab: 'attrition', from: period?.from ?? '', to: period?.to ?? '' })} /> : undefined}>
                    <ColumnChart label="Exits per month" legend={[{ label: 'Exits', tone: 'brand' }]}
                      bars={months.map((m) => ({ key: m.m, label: m.short, value: String(m.exits), amount: m.exits, tip: `${m.label}: ${m.exits} exits` }))} />
                  </Section>
                  <Section title="Monthly trend" body="flush" rise>
                    <Table label="Monthly trend" mobile="cards" minWidth={420} rowKey={(m) => m.m} rows={[...months].reverse()}
                      columns={[
                        { key: 'month', header: 'Month', primary: true, render: (m) => m.label },
                        { key: 'resign', header: 'Resigned', numeric: true, render: (m) => num(m.resign) },
                        { key: 'term', header: 'Terminated', numeric: true, render: (m) => num(m.term) },
                        { key: 'other', header: 'Other', numeric: true, render: (m) => num(m.other) },
                        { key: 'rate', header: 'Rate', numeric: true, render: (m) => `${m.pct.toFixed(1)}%` },
                      ] as TableColumn<(typeof months)[number]>[]} />
                  </Section>
                </div>
              </>
            ) : (
              <>
                <Section title="Company-wide" count={`${num(gender.all)} people`} countLabel="People counted" rise>
                  <MiniStatGrid>
                    <MiniStat label="Women" value={`${pctOf(gender.total.women, gender.all)}%`} note={`${num(gender.total.women)} people`} tone="info" countUp={false} />
                    <MiniStat label="Men" value={`${pctOf(gender.total.men, gender.all)}%`} note={`${num(gender.total.men)} people`} tone="success" countUp={false} />
                    <MiniStat label="Other or not said" value={`${pctOf(gender.total.other, gender.all)}%`} note={`${num(gender.total.other)} people`} tone="neutral" countUp={false} />
                  </MiniStatGrid>
                </Section>
                <Section title="Women by department" sub="Share of each department" rise empty={gender.byDept.length ? false : { title: 'No records for this period.' }}>
                  <BarList label="Women by department" valueWidth={48}
                    items={gender.byDept.map((g) => ({
                      key: g.id ?? 'none', label: g.id ? g.dept : <span className="rp-italic">{g.dept}</span>, value: `${pctOf(g.women, g.all)}%`, pct: pctOf(g.women, g.all),
                      tone: pctOf(g.women, g.all) < 30 ? 'warning' : 'brand', title: `${g.dept}: ${g.women} of ${g.all} people are women`,
                    }))} />
                </Section>
              </>
            )}
    </PageFrame>
  )
}
