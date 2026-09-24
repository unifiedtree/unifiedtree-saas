// Payroll Dashboard — ported from the design component PayDashboard.dc.html.
// Figures come from the payroll runs, dashboard KPIs, disbursement batches and
// statutory filings (see PayrollContainer). TDS isn't calculated by payroll yet,
// so its tile says so instead of showing a number.
import { DCLogic, dc } from './dc-runtime'
import { PayDashboardView } from './PayDashboard.view'
import { dashIcon, dashIconComponent, dashTileIcon } from './icons'
import { inr } from './PayslipDrawer'
import type { RunStatus } from './PayRuns'

/** ₹1.24 Cr / ₹2.10 L / ₹45,000 — the design's short money format, scaled to the amount. */
export const shortInr = (n: number) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : inr(n))

export interface DashRun { id: string; label: string; short: string; status: RunStatus; net: number | null; gross: number | null; employees: number | null; eligible: number | null; bankFile: boolean }
export interface PayDashData {
  companyName: string
  current: DashRun | null
  /** The month the dashboard is about, e.g. "Sep 2026" / "Sep". */
  monthLabel: string; monthShort: string
  prevGross: number | null
  pendingDisb: number | null
  bars: { m: string; value: number }[]
  dues: { what: string; when: string; amount: number | null; note: string }[]
  recent: { id: string; label: string; employees: number; paidOn: string; net: number }[]
  hasRuns: boolean
}

const STEP: Record<string, string> = { draft: 'draft', processing: 'processed', locked: 'locked', paid: 'paid', cancelled: 'draft' }

export class PayDashboard extends DCLogic {
  renderVals() {
    const p = this.props, go = p.onGo || (() => {}), D: PayDashData | undefined = p.data
    const st = p.state || 'live', isLoading = st === 'loading' || !D, isError = st === 'error'
    const isEmpty = !isLoading && !isError && !!D && !D.hasRuns, live = !isLoading && !isError && !isEmpty
    const run = D?.current || null, step = run ? STEP[run.status] || 'draft' : 'draft'
    const ORDER: Record<string, number> = { draft: 0, processed: 1, locked: 2, paid: 3 }, cur = ORDER[step] ?? 0, complete = step === 'paid'
    const label = run ? run.label : D?.monthLabel || '', short = run ? run.short : D?.monthShort || ''
    const openRun = () => (run ? go('runs', { runId: run.id }) : go('runs'))
    const gross = run?.gross ?? null, emp = run?.employees ?? null, prev = D?.prevGross ?? null
    const change = gross && prev ? ((gross - prev) / prev) * 100 : null
    const pend = D?.pendingDisb ?? null
    const stats = [
      {
        label: `Total payroll cost · ${short}`, value: gross ? shortInr(gross) : '—', sub: emp ? `Gross pay for ${emp} ${emp === 1 ? 'person' : 'people'}` : 'Calculated when the run is processed',
        trend: change !== null && isFinite(change) ? { dir: change >= 0 ? 'up' : 'down', value: `${Math.abs(change).toFixed(1)}% vs last month` } : undefined,
        icon: dashTileIcon('rupee', 22), color: 'green', onClick: openRun,
      },
      { label: 'Average salary', value: gross && emp ? inr(Math.round(gross / emp)) : '—', sub: 'Per employee, gross', icon: dashTileIcon('users', 22), color: 'teal', onClick: () => go('salary') },
      {
        label: 'Pending disbursals', value: pend === null ? '—' : String(pend),
        sub: pend === null ? 'Needs bank-file access' : pend === 0 ? 'Nothing waiting for the bank' : `${pend === 1 ? 'Run' : 'Runs'} waiting for a bank file`,
        icon: dashTileIcon('building', 22), color: 'teal', onClick: () => go('bank'),
      },
      { label: 'TDS this month', value: '—', sub: 'Not calculated in payroll yet', icon: dashTileIcon('receipt', 22), color: 'green', onClick: openRun },
    ]
    const bars0 = D?.bars || [], max = Math.max(1, ...bars0.map((b) => b.value))
    const bars = bars0.map((b, i, arr) => { const h = Math.round((b.value / max) * 170); return { m: b.m, y: 170 - h, h, label: b.value ? shortInr(b.value).replace('₹', '') : '—', fill: i === arr.length - 1 ? '#0f6e56' : '#a7f3d0' } })
    const PILL: Record<string, [string, string]> = { draft: ['gray', 'Draft'], processed: ['teal', 'Processed'], locked: ['green', 'Locked'], paid: ['ok', 'Paid'] }
    const pill = run ? PILL[step] : ['gray', 'Not created']
    const n = run?.status === 'draft' ? run.eligible : run?.employees
    const hint = !run ? `No run for ${label} yet. Create it from Processing & Payslips.`
      : step === 'draft' ? `Not processed yet. Check the inputs, then process pay for ${n ?? 'everyone with a salary structure'}${n != null ? (n === 1 ? ' person' : ' people') : ''}.`
        : step === 'processed' ? 'Processed and waiting for review. Lock it to make payslips final.'
          : step === 'locked' ? (run.bankFile ? 'Locked. The bank file is ready — upload it, then mark the run as paid.' : 'Locked. Prepare the bank file next.')
            : 'Paid. Payslips are final and salaries are credited.'
    const dues = (D?.dues || []).map((d) => ({ ...d, note: d.note ? ` · ${d.note}` : '', amountLabel: d.amount ? inr(d.amount) : '—' }))
    const recent = (D?.recent || []).map((r) => ({ ...r, meta: `${r.employees} employees · paid ${r.paidOn || '—'}`, netLabel: inr(r.net), tip: `Opens the ${r.label} run`, onOpen: () => go('runs', { runId: r.id }) }))
    return {
      isLoading, isError, isEmpty, live, stats, bars, chartAria: 'Payroll cost for the last 6 months: ' + bars.map((b) => `${b.m} ${b.label}`).join(', '),
      steps: ['Draft', 'Processed', 'Locked', 'Paid'].map((l, i) => ({ key: l, label: l, meta: !run ? 'Next' : complete || i < cur ? 'Done' : i === cur ? 'Now' : 'Next' })), cur, complete,
      pillTone: pill[0], pillLabel: pill[1], netLabel: run && run.net ? inr(run.net) : '—', hint,
      runCta: !run ? `Create ${label} run` : step === 'paid' ? `View ${label} run` : `Continue ${label} run`,
      companyName: D?.companyName || '', runLabel: label, runTip: run ? `Opens the ${label} payroll run` : 'Opens Processing & Payslips',
      openRunLabel: run ? `Open ${label} run` : 'All payroll runs', progressLabel: `${label} progress`,
      dues, noDues: dues.length === 0, duesEmpty: 'No statutory filings are due. They’re tracked under Compliance → Statutory Filings.',
      recent, noRecent: recent.length === 0, recentEmpty: 'No paid runs yet.',
      openRun, goRuns: () => go('runs'), goSalary: () => go('salary'),
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('receipt'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() }, emptyAction: { label: 'Open Salary Structure', onClick: () => go('salary') },
      skA: { style: { height: 150, width: '100%', borderRadius: 16 } }, skB: { style: { height: 320, width: '100%', borderRadius: 16 } },
      icPlay: dashIcon('activity', 15), icList: dashIcon('list', 15), icCal: dashIcon('calendar', 17),
    }
  }
  render() { return dc(this, PayDashboardView, 'PayDashboard') }
}
