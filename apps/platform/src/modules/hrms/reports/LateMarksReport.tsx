// Every late arrival in a date range, with minutes late and check-in time, in
// the Workforce Analytics design's report layout (ReportKit). A check-in is
// late after its shift's start plus that shift's grace.
import { useLateMarksReport } from '@/modules/hrms/api/useReports'
import { StatusPill } from '@/design/kit/display'
import { stackedBarsSvg } from '@/shared/export/charts'
import { useReportCompany } from './useReportCompany'
import { useReportRange, ReportRangeFilter, monthStartIso, longDate, dayMonth, ReportPage, KpiRow, KPI_ICON, ReportSection, BarsChart, ReportTable, downloadChart, num, sortKey, slug, type Kpi } from './ReportKit'

const long = longDate, dayShort = dayMonth
const time = (at: string | null) => (at ? new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
const SERIES: [string, string][] = [['Late marks', 'var(--u-br,#0F6E56)']]

export function LateMarksReport() {
  const co = useReportCompany()
  const { from, to, setRange, TODAY } = useReportRange(monthStartIso())
  const q = useLateMarksReport(co.company || null, from, to)

  const rows = (q.data ?? []).map((r) => ({
    id: `${r.employee_code}-${r.attendance_date}`, code: r.employee_code, name: r.employee_name, dept: r.department || 'No department', none: !r.department,
    date: r.attendance_date, late: Number(r.late_by_minutes) || 0, checkIn: r.check_in_at,
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.late - a.late))
  type Row = (typeof rows)[number]
  const people = new Map<string, { name: string; count: number; mins: number }>()
  for (const r of rows) { const p = people.get(r.code) || { name: r.name, count: 0, mins: 0 }; p.count++; p.mins += r.late; people.set(r.code, p) }
  const most = [...people.values()].sort((a, b) => b.count - a.count || b.mins - a.mins)[0]
  const total = rows.reduce((a, r) => a + r.late, 0)
  const days = [...rows.reduce((m, r) => m.set(r.date, (m.get(r.date) || 0) + 1), new Map<string, number>()).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const state = q.isLoading ? 'loading' : q.error ? 'error' : rows.length ? 'live' : 'empty'
  const range = `${long(from)} – ${long(to)}`

  const kpis: Kpi[] = [
    { label: 'Late marks', value: num(rows.length), sub: range, color: 'orange', icon: KPI_ICON.alarm },
    { label: 'People late', value: num(people.size), sub: people.size ? `${(rows.length / people.size).toFixed(1)} marks each on average` : '—', color: 'blue', icon: KPI_ICON.users },
    { label: 'Average lateness', value: rows.length ? mins(Math.round(total / rows.length)) : '—', sub: `${mins(total)} in all`, color: 'purple', icon: KPI_ICON.clock },
    { label: 'Most often late', value: most ? most.name : '—', sub: most ? `${most.count} ${most.count === 1 ? 'time' : 'times'} · ${mins(most.mins)}` : '', color: 'red', icon: KPI_ICON.trend },
  ]
  const fileBase = `late-marks-${slug(co.companyName)}-${from}_${to}`
  const chart = () => stackedBarsSvg({ title: 'Late marks per day', subtitle: `${co.companyName} · ${range}`, bars: days.map(([d, n]) => ({ label: dayShort(d), parts: [n] })), series: SERIES })
  const HEAD = ['Date', 'Code', 'Name', 'Department', 'Check-in', 'Late by (min)']
  const table = () => rows.map((r) => [long(r.date), r.code, r.name, r.dept, time(r.checkIn), r.late])

  return (
    <ReportPage title="Late marks report" subtitle="Every late arrival, with minutes late and check-in time" report="late-marks" co={co}
      filters={<ReportRangeFilter from={from} to={to} max={TODAY} onChange={setRange} />}
      note={range}
      state={state} errText={q.error ? `${(q.error as Error).message}. Your filters are kept.` : undefined} onRetry={() => q.refetch()}
      exports={{
        fileBase, csvParams: { from, to },
        sheets: () => [{ name: 'Summary', widths: [24, 34], rows: [['Late marks report', ''], ['Company', co.companyName], ['Range', range], ...kpis.map((k) => [k.label, k.value])] }, { name: 'Late marks', widths: [14, 12, 26, 22, 10, 12], rows: [HEAD, ...table()] }, { name: 'By person', widths: [26, 10, 14], rows: [['Name', 'Late marks', 'Minutes late'], ...[...people.values()].sort((a, b) => b.count - a.count).map((p) => [p.name, p.count, p.mins])] }],
      }}>
      <KpiRow items={kpis} />
      <ReportSection title="Late marks per day" legend={SERIES}
        onDownload={() => downloadChart(`late-marks-per-day-${slug(co.companyName)}-${from}_${to}.png`, chart(), { report: 'late-marks', companyId: co.company, filters: { from, to } })}>
        <BarsChart series={SERIES} unit="late marks" bars={days.map(([d, n]) => ({ key: d, label: dayShort(d), parts: [n], tip: `${n} late ${n === 1 ? 'mark' : 'marks'} · ${long(d)}` }))} />
      </ReportSection>
      <ReportTable<Row & { sL: string }>
        title="Late marks" subtitle="Late means after the shift’s start plus its grace time"
        search={{ placeholder: 'Search name, code or department…', match: (r, s) => `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(s) }}
        rows={rows.map((r) => ({ ...r, sL: sortKey(r.late) }))}
        columns={[
          { key: 'date', header: 'Date', sortable: true, render: (r) => <span>{long(r.date)}</span> },
          { key: 'name', header: 'Employee', sortable: true, render: (r) => <span><span>{r.name}</span><span className="rp-code">{r.code}</span></span> },
          { key: 'dept', header: 'Department', sortable: true, render: (r) => <span className={r.none ? 'rp-italic' : undefined}>{r.dept}</span> },
          { key: 'checkIn', header: 'Check-in', render: (r) => time(r.checkIn) },
          { key: 'sL', header: 'Late by', sortable: true, render: (r) => <StatusPill tone={r.late >= 30 ? 'danger' : 'warning'}>{mins(r.late)}</StatusPill> },
        ]}
      />
    </ReportPage>
  )
}
