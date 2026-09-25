// Processing & Payslips — all payroll runs, ported from the design component
// PayRuns.dc.html. Runs come from the payroll API via PayrollContainer, already
// shaped as RunRow; a figure the run doesn't have yet is null and shows a dash.
import { createElement, createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayRunsView } from './PayRuns.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'

export type RunStatus = 'draft' | 'processing' | 'locked' | 'paid' | 'cancelled'
export interface RunRow {
  id: string; label: string; companyId: string; company: string; year: number; month: number; status: RunStatus
  employees: number | null; gross: number | null; ded: number | null; net: number | null; processedAt: string; exceptions: number
}
export const RUN_STATUS: Record<RunStatus, { tone: string; label: string }> = {
  draft: { tone: 'gray', label: 'Draft' }, processing: { tone: 'blue', label: 'Processing' }, locked: { tone: 'teal', label: 'Locked' },
  paid: { tone: 'green', label: 'Paid' }, cancelled: { tone: 'red', label: 'Cancelled' },
}
const NEXT: Record<string, string> = { draft: 'Next: process payroll', processing: 'Next: review & lock', locked: 'Next: pay salaries' }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "2026-08" (the dashboard's payroll chart link, ?month=) → the year and month filters. */
const monthFilter = (ym: unknown) => { const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '')); return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: m[1], month: String(Number(m[2])) } : null }

export class PayRuns extends DCLogic {
  state: any = { company: '', year: monthFilter(this.props.month)?.year || '', month: monthFilter(this.props.month)?.month || '', status: '', modalOpen: false, w: typeof window !== 'undefined' ? Math.max(320, window.innerWidth - 170) : 1200 }
  componentDidUpdate(prev: any) {
    if (prev.month !== this.props.month) { const f = monthFilter(this.props.month); if (f) this.setState({ year: f.year, month: f.month }) }
  }
  rootRef = createRef<HTMLDivElement>()
  private ro?: ResizeObserver
  componentDidMount() {
    const el = this.rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    this.ro = new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && Math.abs(w - this.state.w) > 4) this.setState({ w }) })
    this.ro.observe(el)
  }
  componentWillUnmount() { this.ro?.disconnect() }
  renderVals() {
    const p = this.props, s = this.state, go = p.onGo || (() => {}), canManage = !!p.canManage
    const st = p.state || 'live', isLoading = st === 'loading', isError = st === 'error'
    const companies: { id: string; name: string }[] = p.companies || []
    const src: RunRow[] = isLoading || isError ? [] : p.runs || []
    const all = src.map((r) => {
      const sm = RUN_STATUS[r.status] || RUN_STATUS.draft, open = () => go('runs', { runId: r.id })
      const L = (v: number | null) => (v === null || v === undefined ? '—' : inr(v))
      return {
        ...r, tone: sm.tone, statusLabel: sm.label,
        employeesL: r.employees === null || r.employees === undefined ? '—' : String(r.employees), grossL: L(r.gross), dedL: L(r.ded), netL: L(r.net),
        processedL: r.processedAt || '—', exc: r.exceptions || 0, hasExc: (r.exceptions || 0) > 0,
        excLabel: `${r.exceptions} exception${r.exceptions === 1 ? '' : 's'}`, next: NEXT[r.status] || '',
        onOpen: open,
        onKey: (e: any) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } },
        onReview: (e: any) => { if (e && e.stopPropagation) e.stopPropagation(); go('runs', { runId: r.id, tab: 'skipped' }) },
        aria: `${r.label}, ${r.company}, ${sm.label}${r.exceptions ? `, ${r.exceptions} exceptions` : ''}. Open run`,
        sortKey: (r.year || 0) * 100 + (r.month || 0),
      }
    }).sort((a, b) => b.sortKey - a.sortKey || a.company.localeCompare(b.company))
    const scope = all.filter((r) => (!s.company || r.companyId === s.company) && (!s.year || String(r.year) === s.year) && (!s.month || String(r.month) === s.month))
    const shown = scope.filter((r) => !s.status || r.status === s.status)
    const dim = '#64748b', ink = '#0f172a', na = (v: string) => v === '—'
    const rows = shown.map((r, i) => ({
      ...r, notFirst: i > 0, showNext: !!r.next && !r.hasExc,
      empOk: !na(r.employeesL), empNa: na(r.employeesL), grossOk: !na(r.grossL), grossNa: na(r.grossL), dedOk: !na(r.dedL), dedNa: na(r.dedL),
      netOk: !na(r.netL), netNa: na(r.netL), procOk: !na(r.processedL), procNa: na(r.processedL),
    }))
    const thisYear = new Date().getFullYear(), years = [...new Set(all.map((r) => r.year).concat([thisYear]))].sort((a, b) => b - a)
    const unit = (n: number) => (n === 1 ? 'run' : 'runs')
    const openModal = () => this.setState({ modalOpen: true })
    const pick = (k: string) => (isError ? undefined : () => this.setState((ss: any) => ({ status: ss.status === k ? '' : k })))
    const stage = ([key, label, icon, desc]: string[]) => {
      const inS = scope.filter((r) => r.status === key), n = inS.length, x = inS.reduce((a, r) => a + r.exc, 0)
      return {
        key, label, icon, desc, tone: (RUN_STATUS as any)[key]?.tone || 'gray', value: isError ? '—' : String(n), unit: isError ? '' : unit(n), active: s.status === key, onSelect: pick(key),
        alert: !isError && x && key !== 'paid' ? `${x} exception${x === 1 ? '' : 's'} to review` : '', tip: s.status === key ? 'Show all runs' : `Show ${label.toLowerCase()} runs`,
      }
    }
    const stages = [
      ['draft', 'Draft', 'filePen', 'Run created. Process it to calculate everyone’s pay.'],
      ['processing', 'Processing', 'calculator', 'Payslips calculated. Review them and clear exceptions.'],
      ['locked', 'Locked', 'lock', 'Period locked. Payslips are final — send salaries.'],
      ['paid', 'Paid', 'banknote', 'Salaries reached bank accounts. Run closed.'],
    ].map(stage)
    const asideStage = Object.assign(stage(['cancelled', 'Cancelled', 'circleX', 'Stopped before payment. Kept for your records.']), { stepLabel: 'Ended' })
    const opt = (v: string, l?: string) => ({ value: v, label: l || v })
    const filters = [
      { key: 'company', allLabel: 'All companies', ariaLabel: 'Company', value: s.company, options: companies.map((c) => opt(c.id, c.name)), onChange: (v: string) => this.setState({ company: v }) },
      { key: 'year', allLabel: 'All years', ariaLabel: 'Year', value: s.year, options: years.map((y) => opt(String(y))), onChange: (v: string) => this.setState({ year: v }) },
      { key: 'month', allLabel: 'All months', ariaLabel: 'Month', value: s.month, options: MONTHS.map((m, i) => opt(String(i + 1), m)), onChange: (v: string) => this.setState({ month: v }) },
      { key: 'status', allLabel: 'All statuses', ariaLabel: 'Status', value: s.status, options: (['draft', 'processing', 'locked', 'paid', 'cancelled'] as RunStatus[]).map((k) => opt(k, RUN_STATUS[k].label)), onChange: (v: string) => this.setState({ status: v }) },
    ]
    const num = (v: string, weight: number) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: v === '—' ? dim : ink, fontWeight: v === '—' ? 500 : weight } }, v)
    const excNode = (r: any) => createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' } },
      createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 11.5, fontWeight: 700 } }, dashIcon('alertTriangle', 12), r.excLabel),
      createElement('button', { type: 'button', onClick: r.onReview, 'data-tip': `Opens ${r.label} on its exceptions`, style: { border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#0f6e56', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' } }, 'Review'))
    const columns = [
      { key: 'label', header: 'Pay cycle', render: (r: any) => createElement('div', { style: { display: 'grid', gap: 2, minWidth: 0 } },
        createElement('button', { type: 'button', 'aria-label': r.aria, onClick: (e: any) => { e.stopPropagation(); r.onOpen() }, style: { justifySelf: 'start', border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 15, fontWeight: 700, color: ink, textAlign: 'left', cursor: 'pointer' } }, r.label),
        createElement('span', { style: { fontSize: 12.5, fontWeight: 500, color: dim, whiteSpace: 'nowrap' } }, r.company)) },
      { key: 'employees', header: 'Employees', render: (r: any) => num(r.employeesL, 600) },
      { key: 'gross', header: 'Gross', render: (r: any) => num(r.grossL, 600) },
      { key: 'ded', header: 'Deductions', render: (r: any) => num(r.dedL, 600) },
      { key: 'net', header: 'Net pay', render: (r: any) => num(r.netL, 800) },
      { key: 'processed', header: 'Processed', render: (r: any) => num(r.processedL, 500) },
      { key: 'status', header: 'Status', render: (r: any) => createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 } },
        createElement('div', { style: { display: 'grid', gap: 6, justifyItems: 'start' } },
          createElement(HrStatusPill, { tone: r.tone } as any, r.statusLabel),
          r.hasExc ? excNode(r) : r.next ? createElement('span', { style: { fontSize: 12, fontWeight: 500, color: dim, whiteSpace: 'nowrap' } }, r.next) : null),
        createElement('span', { 'aria-hidden': true, style: { display: 'inline-flex', color: '#94a3b8' } }, dashIcon('chevronRight', 18))) },
    ]
    const bar = (w: number, h?: number, extra?: any) => createElement('span', { 'aria-hidden': true, style: Object.assign({ display: 'block', width: w, height: h || 12, borderRadius: 6, background: '#eef2f5', animation: 'ut-pulse 1.4s ease-in-out infinite' }, extra) })
    const HEAD = ['Pay cycle', 'Employees', 'Gross', 'Deductions', 'Net pay', 'Processed', 'Status'], BW = [0, 34, 92, 78, 96, 82, 0]
    const skelColumns = HEAD.map((h, i) => ({ key: 'c' + i, header: h, render: (k: any) => (i === 0 ? createElement('div', { style: { display: 'grid', gap: 7 } }, bar(78, 14, { animationDelay: k.delay }), bar(140, 10, { animationDelay: k.delay })) : i === 6 ? bar(76, 22, { borderRadius: 999, animationDelay: k.delay }) : bar(BW[i], 13, { animationDelay: k.delay })) }))
    const skelData = [0, 1, 2, 3, 4, 5].map((i) => {
      const delay = `${i * 90}ms`
      return {
        id: 's' + i, delay, notFirst: i > 0,
        top: createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } }, createElement('div', { style: { display: 'grid', gap: 7 } }, bar(84, 14, { animationDelay: delay }), bar(150, 10, { animationDelay: delay })), bar(76, 22, { borderRadius: 999, animationDelay: delay })),
        bottom: createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: 12 } }, [0, 1, 2, 3, 4].map((j) => createElement('div', { key: j, style: { display: 'grid', gap: 6 } }, bar(58, 9, { animationDelay: delay }), bar(84, 13, { animationDelay: delay })))),
      }
    })
    const narrow = !!p.mobile || s.w < 1160
    const isEmpty = !isLoading && !isError && all.length === 0, live = !isLoading && !isError && all.length > 0
    return {
      rootRef: this.rootRef,
      headerActions: canManage
        ? createElement(HrButton, { onClick: openModal, 'data-tip': 'Start payroll for a new month' } as any, dashIcon('plus', 16), 'New run')
        : createElement(HrStatusPill, { tone: 'gray' } as any, 'View only'),
      stages, asideStage, isLoading, isError, isEmpty, live, asTable: !narrow, asRows: narrow,
      noStepFilter: !s.status, hasStepFilter: !!s.status, statusFilterLabel: s.status ? (RUN_STATUS as any)[s.status].label.toLowerCase() : '', clearStatus: () => this.setState({ status: '' }),
      countLabel: isLoading ? 'Loading…' : isError ? 'Unavailable' : shown.length === all.length ? `${all.length} ${unit(all.length)}` : `${shown.length} of ${all.length} runs`,
      filters, clearFilters: () => this.setState({ company: '', year: '', month: '', status: '' }),
      rows, noRows: rows.length === 0, columns, openRow: (r: any) => r.onOpen(), skelColumns, skelData,
      errIcon: dashIconComponent('alertTriangle'), emptyIcon: dashIconComponent('receipt'),
      retryAction: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      emptyDesc: canManage ? 'Create your first run to begin processing payroll.' : 'Runs appear here once a payroll admin creates the first one.',
      emptyAction: canManage ? { label: '+ New run', onClick: openModal } : undefined,
      modalOpen: s.modalOpen && canManage, companies,
      takenRuns: all.map((r) => ({ id: r.id, company: r.companyId, year: r.year, month: r.month, label: r.label, status: r.status, statusLabel: r.statusLabel })),
      closeModal: () => this.setState({ modalOpen: false }),
      createRun: async (q: { companyId: string; year: number; month: number }) => {
        const ok = p.onCreate ? await p.onCreate(q) : false
        if (ok !== false) this.setState({ modalOpen: false })
        return ok
      },
      openExisting: (id: string) => { this.setState({ modalOpen: false }); go('runs', { runId: id }) },
      icFlow: dashIcon('workflow', 18), icReceipt: dashIcon('receipt', 18), icX: dashIcon('x', 13), icChevron: dashIcon('chevronRight', 18), icWarnSm: dashIcon('alertTriangle', 12),
    }
  }
  render() { return dc(this, PayRunsView, 'PayRuns') }
}
