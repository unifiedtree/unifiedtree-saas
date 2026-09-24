// Leave entitlement, carry-forward, used, pending and available days per person
// and leave type for a year, in the Workforce Analytics design's report layout
// (ReportKit).
import { useSearchParams } from 'react-router-dom'
import { useLeaveBalanceReport } from '@/modules/hrms/api/useReports'
import { HrSelect } from '@/shared/components/hr'
import { stackedBarsSvg } from '@/shared/export/charts'
import { useReportCompany } from './useReportCompany'
import { ReportPage, KpiRow, KPI_ICON, ReportSection, BarsChart, ReportTable, downloadChart, num, sortKey, slug, printHead, printKpis, printTable, type Kpi } from './ReportKit'

const YEAR = new Date().getFullYear()
const YEARS = [YEAR + 1, YEAR, YEAR - 1, YEAR - 2].map((y) => ({ value: String(y), label: String(y) }))
const SERIES: [string, string][] = [['Used', '#0f6e56'], ['Pending', '#34d399'], ['Available', '#a7f3d0']]
const d1 = (n: number) => (Number.isInteger(n) ? num(n) : n.toFixed(1))
/** Codes like CASUAL_LEAVE read as "Casual leave"; real names are kept as written. */
const typeLabel = (t: string) => (/^[A-Z0-9_]+$/.test(t) ? t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : t)

export function LeaveBalanceReport() {
  const [params, setParams] = useSearchParams()
  const co = useReportCompany()
  const year = params.get('year') ?? String(YEAR)
  const setYear = (v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('year', v); return n }, { replace: true })
  const q = useLeaveBalanceReport(co.company || null, year)

  const rows = (q.data ?? []).map((r) => ({
    id: `${r.employee_code}-${r.leave_type}`, code: r.employee_code, name: r.employee_name, dept: r.department || 'No department', none: !r.department,
    type: typeLabel(r.leave_type), ent: Number(r.total_entitlement) || 0, cf: Number(r.carry_forward) || 0, used: Number(r.used) || 0, pending: Number(r.pending) || 0, avail: Number(r.available) || 0,
  }))
  type Row = (typeof rows)[number]
  const sum = (k: 'ent' | 'cf' | 'used' | 'pending' | 'avail') => rows.reduce((a, r) => a + r[k], 0)
  const people = new Set(rows.map((r) => r.code)).size
  const types = [...rows.reduce((m, r) => { const t = m.get(r.type) || { type: r.type, used: 0, pending: 0, avail: 0 }; t.used += r.used; t.pending += r.pending; t.avail += Math.max(0, r.avail); m.set(r.type, t); return m }, new Map<string, { type: string; used: number; pending: number; avail: number }>()).values()]
  const state = q.isLoading ? 'loading' : q.error ? 'error' : rows.length ? 'live' : 'empty'

  const kpis: Kpi[] = [
    { label: 'People', value: num(people), sub: `${types.length} leave ${types.length === 1 ? 'type' : 'types'}`, color: 'blue', icon: KPI_ICON.users },
    { label: 'Days available', value: d1(sum('avail')), sub: `of ${d1(sum('ent') + sum('cf'))} entitled + carried`, color: 'green', icon: KPI_ICON.calendar },
    { label: 'Days used', value: d1(sum('used')), sub: `In ${year}`, color: 'teal', icon: KPI_ICON.check },
    { label: 'Pending approval', value: d1(sum('pending')), sub: 'Requested, not yet decided', color: 'orange', icon: KPI_ICON.hourglass },
  ]
  const fileBase = `leave-balance-${slug(co.companyName)}-${year}`
  const chart = () => stackedBarsSvg({ title: 'Leave by type', subtitle: `${co.companyName} · ${year}`, bars: types.map((t) => ({ label: t.type, parts: [t.used, t.pending, t.avail] })), series: SERIES })
  const HEAD = ['Code', 'Name', 'Department', 'Leave type', 'Entitled', 'Carried forward', 'Used', 'Pending', 'Available']
  const table = () => rows.map((r) => [r.code, r.name, r.dept, r.type, r.ent, r.cf, r.used, r.pending, r.avail])
  const foot = ['Total', '', '', '', sum('ent'), sum('cf'), sum('used'), sum('pending'), sum('avail')]

  return (
    <ReportPage title="Leave Balance Report" subtitle="Entitlement, carry-forward, used, pending and available days per person" report="leave-balance" co={co}
      filters={<div style={{ flex: '0 1 140px', minWidth: 0 }}><HrSelect value={year} options={YEARS} onChange={setYear} size="sm" /></div>}
      note={`Leave year ${year}`}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: { year },
        sheets: () => [{ name: 'Summary', widths: [24, 34], rows: [['Leave balance report', ''], ['Company', co.companyName], ['Year', year], ...kpis.map((k) => [k.label, k.value])] }, { name: 'Balances', widths: [12, 26, 22, 16, 10, 15, 8, 9, 10], rows: [HEAD, ...table(), foot] }],
        print: () => printHead('Leave balance report', `${co.companyName} · ${year}`) + printKpis(kpis) + `<div class="card">${chart().svg}</div>` + printTable('Balances', HEAD, table(), foot),
      }}>
      <KpiRow items={kpis} />
      <ReportSection title="Leave by type" legend={SERIES}
        onDownload={() => downloadChart(`leave-by-type-${slug(co.companyName)}-${year}.png`, chart(), { report: 'Leave Balance', company: co.companyName })}>
        <BarsChart series={SERIES} unit="days" bars={types.map((t) => ({ key: t.type, label: t.type, parts: [t.used, t.pending, t.avail] }))} />
      </ReportSection>
      <ReportTable<Row & { sE: string; sU: string; sP: string; sA: string }>
        title="Balances" subtitle="One row per person and leave type"
        search={{ placeholder: 'Search name, code, department or type…', match: (r, s) => `${r.name} ${r.code} ${r.dept} ${r.type}`.toLowerCase().includes(s) }}
        rows={rows.map((r) => ({ ...r, sE: sortKey(r.ent + r.cf), sU: sortKey(r.used), sP: sortKey(r.pending), sA: sortKey(r.avail) }))}
        columns={[
          { key: 'name', header: 'Employee', sortable: true, render: (r) => <span><span style={{ fontWeight: 700 }}>{r.name}</span><span style={{ display: 'block', fontSize: 12, color: '#64748b', fontFamily: 'JetBrains Mono,monospace' }}>{r.code}</span></span> },
          { key: 'dept', header: 'Department', sortable: true, render: (r) => <span style={{ color: r.none ? '#64748b' : undefined, fontStyle: r.none ? 'italic' : 'normal' }}>{r.dept}</span> },
          { key: 'type', header: 'Leave type', sortable: true, render: (r) => <span style={{ fontWeight: 600 }}>{r.type}</span> },
          { key: 'sE', header: 'Entitled', sortable: true, render: (r) => <span>{d1(r.ent)}{r.cf ? <span style={{ color: '#64748b' }}> + {d1(r.cf)}</span> : null}</span> },
          { key: 'sU', header: 'Used', sortable: true, render: (r) => d1(r.used) },
          { key: 'sP', header: 'Pending', sortable: true, render: (r) => (r.pending ? <b style={{ color: '#b45309' }}>{d1(r.pending)}</b> : <span style={{ color: '#94a3b8' }}>0</span>) },
          { key: 'sA', header: 'Available', sortable: true, render: (r) => <b style={{ color: r.avail < 0 ? '#b91c1c' : '#0f6e56' }}>{d1(r.avail)}</b> },
        ]}
        footerCells={['Total', '', '', `${d1(sum('ent'))} + ${d1(sum('cf'))}`, d1(sum('used')), d1(sum('pending')), d1(sum('avail'))]}
        card={(r) => ({ title: `${r.name} · ${r.type}`, big: d1(r.avail), small: 'available', stats: [['Entitled', d1(r.ent + r.cf)], ['Used', d1(r.used)], ['Pending', d1(r.pending)]] })}
      />
    </ReportPage>
  )
}
