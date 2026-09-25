// Monthly exits and attrition rate, in the Workforce Analytics design's report
// layout (ReportKit). Every month in the range is shown, including months
// without exits. Exits are split into resigned, terminated and other from the
// exit type HR records on Start notice / Mark exited (V143.13); exits recorded
// before the type existed count as other.
import { useSearchParams } from 'react-router-dom'
import { useAttritionReport } from '@/modules/hrms/api/useReports'
import { lineSvg } from '@/shared/export/charts'
import { useReportCompany } from './useReportCompany'
import { todayIso, monthStartIso, ReportPage, KpiRow, KPI_ICON, ReportSection, TrendChart, ReportTable, DateFilter, downloadChart, num, sortKey, slug, printHead, printKpis, printTable, type Kpi } from './ReportKit'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}` }
const short = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ’${String(y).slice(2)}` }

export function AttritionReport() {
  const [params, setParams] = useSearchParams()
  const co = useReportCompany()
  const TODAY = todayIso()
  const from = params.get('from') ?? monthStartIso(11), to = params.get('to') ?? TODAY
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n }, { replace: true })
  const q = useAttritionReport(co.company || null, from, to)

  const rows = (q.data ?? []).map((r) => ({
    id: r.month, month: r.month, label: label(r.month), short: short(r.month), exits: Number(r.exits) || 0, resign: Number(r.resignations) || 0,
    term: Number(r.terminations) || 0, other: Number(r.other_exits) || 0, headcount: Number(r.headcount) || 0, pct: Number(r.attrition_pct) || 0,
  }))
  type Row = (typeof rows)[number]
  const exits = rows.reduce((a, r) => a + r.exits, 0), term = rows.reduce((a, r) => a + r.term, 0)
  const avg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0
  const peak = rows.reduce<Row | null>((a, r) => (!a || r.pct > a.pct ? r : a), null)
  const state = q.isLoading ? 'loading' : q.error ? 'error' : rows.length ? 'live' : 'empty'
  const range = rows.length ? `${rows[0].label} – ${rows[rows.length - 1].label}` : ''
  const split = (r: Row) => [r.resign && `${r.resign} resigned`, r.term && `${r.term} terminated`, r.other && `${r.other} other`].filter(Boolean).join(' · ') || 'none'

  const kpis: Kpi[] = [
    { label: 'Exits in range', value: num(exits), sub: range, color: 'red', icon: KPI_ICON.trend },
    { label: 'Average monthly attrition', value: `${avg.toFixed(1)}%`, sub: `${rows.length} ${rows.length === 1 ? 'month' : 'months'}`, color: 'orange', icon: KPI_ICON.pie },
    { label: 'Highest month', value: peak && peak.exits ? `${peak.pct.toFixed(1)}%` : '—', sub: peak && peak.exits ? `${peak.label} · ${peak.exits} exits` : 'No exits in range', color: 'purple', icon: KPI_ICON.calendar },
    { label: 'Terminations', value: num(term), sub: exits ? `${Math.round((term / exits) * 100)}% of exits` : 'No exits in range', color: 'blue', icon: KPI_ICON.users },
  ]
  const fileBase = `attrition-${slug(co.companyName)}-${from}_${to}`
  const chart = () => lineSvg({ title: 'Monthly attrition', subtitle: `${co.companyName} · ${range}`, points: rows.map((r) => ({ label: r.short, value: r.pct })) })
  const HEAD = ['Month', 'Exits', 'Resigned', 'Terminated', 'Other', 'Headcount', 'Attrition %']
  const table = () => rows.map((r) => [r.label, r.exits, r.resign, r.term, r.other, r.headcount, r.pct])
  const foot = ['Total', exits, rows.reduce((a, r) => a + r.resign, 0), term, rows.reduce((a, r) => a + r.other, 0), '', `${avg.toFixed(1)} avg`]

  return (
    <ReportPage title="Attrition Report" subtitle="Monthly exits, resignations, terminations and attrition rate" report="attrition" co={co} skeleton="line"
      filters={<><DateFilter label="From" value={from} max={to} onChange={(v) => set('from', v)} /><DateFilter label="To" value={to} min={from} max={TODAY} onChange={(v) => set('to', v)} /></>}
      note={range && `Showing ${range}`}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: { from, to },
        sheets: () => [{ name: 'Summary', widths: [28, 30], rows: [['Attrition report', ''], ['Company', co.companyName], ['Range', range], ...kpis.map((k) => [k.label, k.value])] }, { name: 'Monthly attrition', widths: [12, 8, 10, 11, 8, 11, 12], rows: [HEAD, ...table()] }],
        print: () => printHead('Attrition report', `${co.companyName} · ${range}`) + printKpis(kpis) + `<div class="card">${chart().svg}</div>` + printTable('Months', HEAD, table(), foot),
      }}>
      <KpiRow items={kpis} />
      <ReportSection title="Monthly attrition" aside={<span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{range}</span>} legend={[['Attrition %', '#0f6e56', 'line']]}
        onDownload={() => downloadChart(`monthly-attrition-${slug(co.companyName)}-${from}_${to}.png`, chart(), { report: 'Attrition', company: co.companyName })}>
        <TrendChart points={rows.map((r) => ({ key: r.id, short: r.short, value: r.pct }))} readout={(i) => {
          const r = rows[i]
          return <>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: '#0a5240' }}>{r.label}</span>
            <span style={{ fontSize: 13, color: '#334155' }}><b style={{ color: '#0f172a' }}>{r.pct.toFixed(1)}%</b> attrition</span>
            <span style={{ fontSize: 13, color: '#334155' }}><b style={{ color: '#0f172a' }}>{r.exits}</b> exits · {split(r)}</span>
            <span style={{ fontSize: 13, color: '#334155' }}>Headcount <b style={{ color: '#0f172a' }}>{num(r.headcount)}</b></span>
          </>
        }} />
      </ReportSection>
      <ReportTable<Row & { sE: string; sP: string; sH: string }>
        title="Months" subtitle="Exits are dated by the person’s last working day"
        rows={rows.map((r) => ({ ...r, sE: sortKey(r.exits), sP: sortKey(r.pct), sH: sortKey(r.headcount) })).reverse()}
        columns={[
          { key: 'month', header: 'Month', sortable: true, render: (r) => <span style={{ fontWeight: 700 }}>{r.label}</span> },
          { key: 'sE', header: 'Exits', sortable: true, render: (r) => <b>{num(r.exits)}</b> },
          { key: 'resign', header: 'Resigned', render: (r) => num(r.resign) },
          { key: 'term', header: 'Terminated', render: (r) => num(r.term) },
          { key: 'other', header: 'Other', render: (r) => num(r.other) },
          { key: 'sH', header: 'Headcount', sortable: true, render: (r) => num(r.headcount) },
          { key: 'sP', header: 'Attrition', sortable: true, render: (r) => <b style={{ color: r.pct ? '#b91c1c' : '#64748b' }}>{r.pct.toFixed(1)}%</b> },
        ]}
        footerCells={foot.map((c) => (typeof c === 'number' ? num(c) : c))}
        card={(r) => ({ title: r.label, big: `${r.pct.toFixed(1)}%`, small: `${r.exits} exits`, stats: [['Resigned', num(r.resign)], ['Terminated', num(r.term)], ['Headcount', num(r.headcount)]] })}
      />
    </ReportPage>
  )
}
