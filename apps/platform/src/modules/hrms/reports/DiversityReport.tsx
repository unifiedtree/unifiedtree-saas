// Gender split of everyone currently employed (active, probation and notice),
// company-wide and per department, in the Workforce Analytics design's report
// layout (ReportKit). People without a recorded gender are counted as "Not
// specified" rather than left out.
import { useReportCompany } from './useReportCompany'
import { useDiversityReport } from '@/modules/hrms/api/useReports'
import { HrStatusPill } from '@/shared/components/hr'
import { donutSvg, stackedBarsSvg } from '@/shared/export/charts'
import { todayIso, longDate, ReportPage, KpiRow, KPI_ICON, ReportSection, DonutChart, BarsChart, ReportTable, downloadChart, num, pctOf, sortKey, slug, printHead, printKpis, printTable, type Kpi } from './ReportKit'

const GENDERS: { key: string; label: string; color: string }[] = [
  { key: 'FEMALE', label: 'Women', color: '#0f6e56' },
  { key: 'MALE', label: 'Men', color: '#34d399' },
  { key: 'OTHER', label: 'Other', color: '#6ee7b7' },
  { key: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', color: '#a7f3d0' },
  { key: 'NOT_SPECIFIED', label: 'Not specified', color: '#d1fae5' },
]

export function DiversityReport() {
  const co = useReportCompany()
  const today = longDate(todayIso())
  const q = useDiversityReport(co.company || null)
  const raw = q.data ?? []
  const byDept = new Map<string, { id: string; deptId: string | null; dept: string; none: boolean; counts: Record<string, number> }>()
  for (const r of raw) {
    const key = r.department_id || '__none'
    const d = byDept.get(key) || { id: key, deptId: r.department_id ?? null, dept: r.department || 'No department', none: !r.department, counts: {} }
    d.counts[r.gender] = (d.counts[r.gender] || 0) + (Number(r.count) || 0)
    byDept.set(key, d)
  }
  const tot = (d: { counts: Record<string, number> }) => Object.values(d.counts).reduce((a, v) => a + v, 0)
  const depts = [...byDept.values()].sort((a, b) => (a.none ? 1 : b.none ? -1 : tot(b) - tot(a)))
  const totals: Record<string, number> = {}
  for (const d of depts) for (const [g, n] of Object.entries(d.counts)) totals[g] = (totals[g] || 0) + n
  const people = Object.values(totals).reduce((a, v) => a + v, 0)
  // Only the genders that actually occur, in a fixed order (plus any the API adds later).
  const series = [...GENDERS.filter((g) => totals[g.key]), ...Object.keys(totals).filter((k) => !GENDERS.some((g) => g.key === k)).map((k) => ({ key: k, label: k.replace(/_/g, ' ').toLowerCase(), color: '#94a3b8' }))]
  const state = q.isLoading ? 'loading' : q.error ? 'error' : people ? 'live' : 'empty'
  const recorded = people - (totals.NOT_SPECIFIED || 0)
  const balanced = depts.filter((d) => !d.none && (d.counts.FEMALE || 0) + (d.counts.MALE || 0) > 0).sort((a, b) => Math.abs(50 - pctOf(a.counts.FEMALE || 0, tot(a))) - Math.abs(50 - pctOf(b.counts.FEMALE || 0, tot(b))))[0]

  const kpis: Kpi[] = [
    { label: 'People counted', value: num(people), sub: 'Active, probation and notice', color: 'blue', icon: KPI_ICON.users },
    { label: 'Women', value: `${pctOf(totals.FEMALE || 0, people)}%`, sub: `${num(totals.FEMALE || 0)} people`, color: 'green', icon: KPI_ICON.check },
    { label: 'Men', value: `${pctOf(totals.MALE || 0, people)}%`, sub: `${num(totals.MALE || 0)} people`, color: 'teal', icon: KPI_ICON.check },
    { label: 'Gender recorded', value: `${pctOf(recorded, people)}%`, sub: totals.NOT_SPECIFIED ? `${num(totals.NOT_SPECIFIED)} without a gender on file` : 'Everyone has one on file', color: 'orange', icon: KPI_ICON.pie },
  ]
  const fileBase = `diversity-${slug(co.companyName)}-${todayIso()}`
  const donut = () => donutSvg({ title: 'Gender split', subtitle: `${co.companyName} · ${today}`, parts: series.map((g) => ({ label: g.label, value: totals[g.key] || 0, color: g.color })) })
  const bars = () => stackedBarsSvg({ title: 'Gender by department', subtitle: co.companyName, bars: depts.map((d) => ({ label: d.dept, parts: series.map((g) => d.counts[g.key] || 0) })), series: series.map((g) => [g.label, g.color] as [string, string]) })
  const HEAD = ['Department', ...series.map((g) => g.label), 'Total', 'Women %']
  const table = () => depts.map((d) => [d.dept, ...series.map((g) => d.counts[g.key] || 0), tot(d), pctOf(d.counts.FEMALE || 0, tot(d))])
  const foot = ['Total', ...series.map((g) => totals[g.key] || 0), people, pctOf(totals.FEMALE || 0, people)]
  type Row = (typeof depts)[number] & { sT: string; sW: string }

  return (
    <ReportPage title="Diversity Report" subtitle="Gender split of the current workforce, company-wide and by department" report="diversity" co={co} note={`Data as of ${today}`}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: {},
        sheets: () => [{ name: 'Summary', widths: [26, 34], rows: [['Diversity report', ''], ['Company', co.companyName], ['As of', today], ...kpis.map((k) => [k.label, k.value])] }, { name: 'By department', widths: [28, ...series.map(() => 12), 10, 10], rows: [HEAD, ...table(), foot] }],
        print: () => printHead('Diversity report', `${co.companyName} · ${today}`) + printKpis(kpis) + `<div class="card">${donut().svg}</div><div class="card">${bars().svg}</div>` + printTable('By department', HEAD, table(), foot),
      }}>
      <KpiRow items={kpis} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        <ReportSection title="Gender split" flex="1 1 300px" pill={<HrStatusPill tone="purple">{`${num(people)} people`}</HrStatusPill>}
          onDownload={() => downloadChart(`gender-split-${slug(co.companyName)}.png`, donut(), { report: 'Diversity', company: co.companyName })}>
          <DonutChart parts={series.map((g) => ({ label: g.label, value: totals[g.key] || 0, color: g.color }))}
            footer={<div style={{ width: '100%', padding: '9px 11px', borderRadius: 10, background: '#f8fafc', border: '1px solid #f1f5f9', fontSize: 12.5, color: '#475569', fontWeight: 500, boxSizing: 'border-box' }}>Most balanced: <b style={{ color: '#0f172a' }}>{balanced ? `${balanced.dept} · ${pctOf(balanced.counts.FEMALE || 0, tot(balanced))}% women` : recorded ? 'Not enough data' : 'No gender recorded yet'}</b></div>} />
        </ReportSection>
        <ReportSection title="Gender by department" flex="2 1 520px" legend={series.map((g) => [g.label, g.color] as [string, string])}
          onDownload={() => downloadChart(`gender-by-department-${slug(co.companyName)}.png`, bars(), { report: 'Diversity', company: co.companyName })}>
          <BarsChart series={series.map((g) => [g.label, g.color] as [string, string])} unit="people"
            bars={depts.map((d) => ({ key: d.id, label: d.dept, none: d.none, parts: series.map((g) => d.counts[g.key] || 0) }))} />
        </ReportSection>
      </div>
      <ReportTable<Row>
        title="By department" subtitle="Everyone currently employed, including probation and notice"
        rows={depts.map((d) => ({ ...d, sT: sortKey(tot(d)), sW: sortKey(pctOf(d.counts.FEMALE || 0, tot(d))) }))}
        columns={[
          { key: 'dept', header: 'Department', sortable: true, render: (d) => <span style={{ fontWeight: 700, color: d.none ? '#64748b' : '#0f6e56', fontStyle: d.none ? 'italic' : 'normal' }}>{d.dept}</span> },
          ...series.map((g) => ({ key: g.key, header: g.label, render: (d: Row) => num(d.counts[g.key] || 0) })),
          { key: 'sT', header: 'Total', sortable: true, render: (d) => <b>{num(tot(d))}</b> },
          { key: 'sW', header: 'Women', sortable: true, render: (d) => `${pctOf(d.counts.FEMALE || 0, tot(d))}%` },
        ]}
        footerCells={foot.map((c, i) => (i === foot.length - 1 ? `${c}%` : typeof c === 'number' ? num(c) : c))}
        card={(d) => ({ title: d.dept, muted: d.none, big: num(tot(d)), small: `${pctOf(d.counts.FEMALE || 0, tot(d))}% women`, stats: series.slice(0, 3).map((g) => [g.label, num(d.counts[g.key] || 0)] as [string, string]) })}
      />
    </ReportPage>
  )
}
