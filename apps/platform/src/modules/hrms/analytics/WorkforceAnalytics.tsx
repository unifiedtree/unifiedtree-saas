// Workforce Analytics (/hrms/workforce-analytics) in the Claude Design export's
// layout (design/dc/WorkforceAnalytics). Loads the headcount, diversity and
// attrition reports for the chosen company and period, each only when the
// person may read it, and does the exports: a print-ready PDF snapshot, an
// Excel workbook, the departments CSV and PNGs of the two charts.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { useHeadcountReport, useDiversityReport, useAttritionReport } from '@/modules/hrms/api/useReports'
import { useEmployeeDirectory } from '@/modules/hrms/api/useWorkforce'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import { WorkforceAnalytics as WorkforceAnalyticsDesign, GENDER_SERIES, type ExportKind, type WaData, type WaDept, type WaGender, type WaMonth } from '@/design/dc/WorkforceAnalytics'
import { csvBlob, xlsxBlob, svgToPng, printDocument, saveAndRecord, esc, type Cell } from '@/shared/export/fileExport'
import { stackedBarsSvg, donutSvg, lineSvg } from '@/shared/export/charts'
import { useReportCompany, slug } from '@/modules/hrms/reports/useReportCompany'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}` }
const monthShort = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ’${String(y).slice(2)}` }
const longDate = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`

/** The design's three periods, computed from today. */
function periodsFor(today: Date) {
  const y = today.getFullYear()
  const start12 = new Date(y, today.getMonth() - 11, 1)
  return [
    { value: 'l12', label: 'Last 12 months', from: iso(start12), to: iso(today) },
    { value: 'ytd', label: `${y} so far`, from: `${y}-01-01`, to: iso(today) },
    { value: `y${y - 1}`, label: `Calendar ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ]
}
const genderKey = (g: string): keyof WaGender => (g === 'FEMALE' ? 'women' : g === 'MALE' ? 'men' : 'other')

export function WorkforceAnalytics() {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const canHead = usePermission(P.HRMS_REPORT_HEADCOUNT), canDiv = usePermission(P.HRMS_REPORT_DIVERSITY), canAttr = usePermission(P.HRMS_REPORT_ATTRITION)
  const canDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const co = useReportCompany()
  const today = useMemo(() => new Date(), [])
  const periods = useMemo(() => periodsFor(today), [today])
  const [period, setPeriod] = useState('l12')
  const range = periods.find((x) => x.value === period) || periods[0]
  const asOf = iso(today)

  const company = co.company || null
  const head = useHeadcountReport(company, asOf, { enabled: canHead && !!company })
  const div = useDiversityReport(company, { enabled: canDiv && !!company })
  const attr = useAttritionReport(company, range.from, range.to, { enabled: canAttr && !!company })
  const dir = useEmployeeDirectory({ companyId: co.company, page: 0, pageSize: 1 }, { enabled: canDirectory && !!company })

  const data: WaData | undefined = useMemo(() => {
    const depts: WaDept[] | null = canHead && head.data ? (() => {
      const rows = head.data.map((r) => ({ id: r.department_id ?? null, dept: r.department || 'No department', none: !r.department, total: Number(r.total) || 0, active: Number(r.active) || 0, notice: Number(r.on_notice) || 0, probation: Number(r.probation) || 0 }))
      return [...rows.filter((r) => !r.none).sort((a, b) => b.total - a.total), ...rows.filter((r) => r.none)]
    })() : null
    const gender = canDiv && div.data ? (() => {
      const total: WaGender = { women: 0, men: 0, other: 0 }, byDept = new Map<string, WaGender>()
      for (const r of div.data) {
        const k = genderKey(r.gender), n = Number(r.count) || 0, key = r.department_id || ''
        total[k] += n
        const g = byDept.get(key) || { women: 0, men: 0, other: 0 }
        g[k] += n; byDept.set(key, g)
      }
      return { total, byDept }
    })() : null
    const months: WaMonth[] | null = canAttr && attr.data ? attr.data.map((r) => ({
      m: r.month, label: monthLabel(r.month), short: monthShort(r.month), exits: Number(r.exits) || 0, resign: Number(r.resignations) || 0, term: Number(r.terminations) || 0,
      other: Number(r.other_exits) || 0, headcount: Number(r.headcount) || 0, pct: Number(r.attrition_pct) || 0,
    })) : null
    return { depts, gender, months, directory: dir.data?.totalElements ?? null }
  }, [canHead, canDiv, canAttr, head.data, div.data, attr.data, dir.data])

  const queries = [canHead && head, canDiv && div, canAttr && attr].filter(Boolean) as { isLoading: boolean; error: unknown; refetch: () => unknown }[]
  const denied = !canHead && !canDiv && !canAttr
  const failed = queries.find((q) => q.error)
  const loading = co.loading || queries.some((q) => q.isLoading)
  const nothing = (!canHead || !data.depts?.length) && (!canDiv || !data.gender || data.gender.total.women + data.gender.total.men + data.gender.total.other === 0) && (!canAttr || !data.months?.some((m) => m.exits > 0))
  const state = denied ? 'denied' : loading ? 'loading' : failed ? 'error' : nothing ? 'empty' : 'live'
  const errText = failed ? `${(failed.error as Error)?.message || 'The report service didn’t answer'}. Your filters are kept.` : ''

  const onOpen = (r: string) => navigate(`/hrms/reports/${r}${co.company ? `?co=${co.company}` : ''}`)
  const onDept = (r: WaDept) => { if (canDirectory) navigate(`/hrms/employees?co=${co.company}${r.id ? `&departmentId=${r.id}` : ''}`) }

  // ── exports ──
  const base = `workforce-analytics-${slug(co.companyName)}-${range.value}`
  const meta = (fmt: string) => ({ report: 'Workforce Analytics', fmt, company: co.companyName })
  const depts = data.depts || [], months = data.months || [], G = data.gender
  const totals = depts.reduce((a, r) => ({ total: a.total + r.total, active: a.active + r.active, notice: a.notice + r.notice, probation: a.probation + r.probation }), { total: 0, active: 0, notice: 0, probation: 0 })
  const womenPct = (id: string | null, none: boolean) => { const g = G?.byDept.get(id || (none ? '' : '#')); const t = g ? g.women + g.men + g.other : 0; return g && t ? Math.round((g.women / t) * 100) : null }
  const deptRows = (): Cell[][] => [
    ['Department', 'Total', 'Active', 'On notice', 'Probation', ...(canDiv ? ['Women %'] : []), 'Share %'],
    ...depts.map((r) => [r.dept, r.total, r.active, r.notice, r.probation, ...(canDiv ? [womenPct(r.id, r.none)] : []), totals.total ? Math.round((r.total / totals.total) * 100) : 0]),
    ['Total', totals.total, totals.active, totals.notice, totals.probation, ...(canDiv ? [G ? Math.round((G.total.women / Math.max(1, G.total.women + G.total.men + G.total.other)) * 100) : null] : []), 100],
  ]
  const headChart = () => stackedBarsSvg({ title: 'Headcount by department', subtitle: `${co.companyName} · as of ${longDate(today)}`, bars: depts.map((r) => ({ label: r.dept, parts: [r.active, r.notice, r.probation] })), series: [['Active', '#0f6e56'], ['On notice', '#34d399'], ['Probation', '#a7f3d0']] })
  const attrChart = () => lineSvg({ title: 'Monthly attrition', subtitle: `${co.companyName} · ${months.length ? `${months[0].label} – ${months[months.length - 1].label}` : range.label}`, points: months.map((m) => ({ label: m.short, value: m.pct })) })
  const genderChart = () => donutSvg({ title: 'Gender diversity', subtitle: co.companyName, parts: GENDER_SERIES.map(([label, k, color]) => ({ label, value: G ? G.total[k] : 0, color })) })

  const onExport = async (k: ExportKind): Promise<string> => {
    if (k === 'csv') {
      const file = `${base}-departments.csv`
      saveAndRecord(file, csvBlob(deptRows()), meta('CSV'))
      return `${file} downloaded`
    }
    if (k === 'xlsx') {
      const sheets = [{ name: 'Summary', widths: [28, 40], rows: [['Workforce Analytics', ''], ['Company', co.companyName], ['Period', range.label], ['Data as of', longDate(today)], ...(canHead ? [['Total headcount', totals.total], ['Active', totals.active], ['On notice', totals.notice], ['Probation', totals.probation]] : []), ...(canAttr && months.length ? [['Attrition (latest month)', `${months[months.length - 1].pct.toFixed(1)}%`]] : [])] as Cell[][] }]
      if (canHead) sheets.push({ name: 'Departments', widths: [28, 10, 10, 12, 12, 10, 10], rows: deptRows() })
      if (canDiv && G) sheets.push({ name: 'Gender', widths: [28, 10, 10, 22], rows: [['Department', 'Women', 'Men', 'Other or not specified'], ...[...G.byDept.entries()].map(([id, g]) => [depts.find((d) => (d.id || '') === id)?.dept || (id ? 'Department' : 'No department'), g.women, g.men, g.other] as Cell[]), ['Total', G.total.women, G.total.men, G.total.other]] })
      if (canAttr) sheets.push({ name: 'Monthly attrition', widths: [12, 8, 11, 12, 8, 12, 12], rows: [['Month', 'Exits', 'Resigned', 'Terminated', 'Other', 'Headcount', 'Attrition %'], ...months.map((m) => [m.label, m.exits, m.resign, m.term, m.other, m.headcount, m.pct] as Cell[])] })
      const file = `${base}.xlsx`
      saveAndRecord(file, xlsxBlob(sheets), meta('Excel'))
      return `${file} downloaded`
    }
    if (k === 'png-headcount' || k === 'png-attrition') {
      const c = k === 'png-headcount' ? headChart() : attrChart()
      const file = k === 'png-headcount' ? `headcount-by-department-${slug(co.companyName)}.png` : `monthly-attrition-${slug(co.companyName)}-${range.value}.png`
      saveAndRecord(file, await svgToPng(c.svg, c.width, c.height), meta('PNG'))
      return `${file} downloaded`
    }
    // PDF: a print-ready page; the browser's "Save as PDF" writes the file.
    const kpi = (label: string, v: string, sub: string) => `<div class="kpi"><span class="muted">${esc(label)}</span><b>${esc(v)}</b><span class="muted">${esc(sub)}</span></div>`
    const last = months[months.length - 1]
    const body = `<h1>Workforce Analytics</h1><div class="muted">${esc(co.companyName)} · ${esc(range.label)} · data as of ${esc(longDate(today))}</div>
<div class="kpis">${canHead ? kpi('Total headcount', totals.total.toLocaleString('en-IN'), `${totals.active} active`) + kpi('On notice / probation', String(totals.notice + totals.probation), `${totals.notice} notice · ${totals.probation} probation`) : ''}${canAttr && last ? kpi('Attrition (latest month)', `${last.pct.toFixed(1)}%`, `${last.exits} exits · ${last.label}`) : ''}${canDiv && G ? kpi('People by gender', (G.total.women + G.total.men + G.total.other).toLocaleString('en-IN'), `${G.total.women} women · ${G.total.men} men`) : ''}</div>
${canHead ? `<div class="card">${headChart().svg}</div>` : ''}${canDiv && G ? `<div class="card">${genderChart().svg}</div>` : ''}${canAttr ? `<div class="card">${attrChart().svg}</div>` : ''}
${canHead ? `<div class="card"><h2>Departments</h2><table><thead><tr>${deptRows()[0].map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${deptRows().slice(1, -1).map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${deptRows()[deptRows().length - 1].map((c) => `<td>${esc(c ?? '—')}</td>`).join('')}</tr></tfoot></table></div>` : ''}`
    if (!printDocument(`${base}.pdf`, body)) throw new Error('Your browser blocked the print window. Allow pop-ups for this site, then try again.')
    return 'Print dialog opened. Choose “Save as PDF” to keep a copy.'
  }

  return (
    <DesignFrame>
      <WorkforceAnalyticsDesign
        state={state} errText={errText} mobile={mobile} locked={co.locked}
        canHead={canHead} canDiv={canDiv} canAttr={canAttr} canDirectory={canDirectory}
        companies={co.options} company={co.company} setCompany={co.setCompany}
        periods={periods.map((x) => ({ value: x.value, label: x.label }))} period={period} setPeriod={setPeriod}
        asOf={longDate(today)} data={data}
        onRetry={() => queries.forEach((q) => q.refetch())} onOpen={onOpen} onDept={onDept} onExport={onExport}
      />
    </DesignFrame>
  )
}
