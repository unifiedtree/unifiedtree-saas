// Salary Structure — ported from the design component PaySalary.dc.html.
// Rows are the directory plus each person's current structure (GET
// /v1/payroll/structures/employee/{id}, fetched for the visible page). Saving
// creates a new structure revision (POST /v1/payroll/structures). A new person
// gets the design's split; an existing structure keeps its own proportions.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PaySalaryView } from './PaySalary.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'

export interface StructureInfo {
  gross: number; net: number; ctcAnnual: number; effectiveFrom: string
  basic: number; hra: number; special: number; deductions: number; dedCodes: string[]
  /** EARNING lines with a component, as saved. */
  earnings: { componentId: string; code: string; amount: number }[]
}
export interface PayCalc { pfOn: boolean; pfEmp: number; pfCeil: number; pfApplyCeil: boolean; esiOn: boolean; esiEmp: number; esiCeil: number; ptFor: (gross: number) => number }
export interface SalaryRow { id: string; code: string; name: string; dept: string; role: string }

/** The design's split for a new structure: Basic 50%, HRA 40% of basic, ₹1,600 conveyance from ₹20,000, special allowance the rest. */
export function designSplit(m: number) {
  const basic = Math.round(m * 0.5), hra = Math.round(basic * 0.4), conv = m >= 20000 ? 1600 : 0, special = Math.max(0, m - basic - hra - conv)
  return { BASIC: basic, HRA: hra, CONVEYANCE: conv, SPECIAL: special }
}
/** An existing structure's earning lines scaled to a new monthly gross; the rounding difference goes to the largest line. */
export function scaleSplit(lines: { componentId: string; code: string; amount: number }[], m: number) {
  const old = lines.reduce((a, l) => a + l.amount, 0) || 1
  const out = lines.map((l) => ({ ...l, amount: Math.round((l.amount * m) / old) }))
  const diff = m - out.reduce((a, l) => a + l.amount, 0)
  if (out.length && diff) { const big = out.reduce((a, l) => (l.amount > a.amount ? l : a), out[0]); big.amount += diff }
  return out
}

export class PaySalary extends DCLogic {
  state: any = { q: '', dept: '', page: 0, size: 10, drawer: null, fMonthly: '', fDate: '', bulk: null, notice: null, busy: false }
  private focused = ''
  private visible = ''
  componentDidMount() { this.follow(); this.report() }
  componentDidUpdate() { this.follow(); this.report() }
  /** Open the drawer for ?employee= (Fix from a run, or a deep link). */
  follow() {
    const f = this.props.focus
    if (f && f !== this.focused && (this.props.employees || []).some((e: SalaryRow) => e.id === f)) { this.focused = f; this.openFor(f) }
  }
  /** Tell the container which people are on screen, so their structures are fetched. */
  report() {
    const ids = this.pageRows().map((r) => r.id)
    if (this.state.drawer && !ids.includes(this.state.drawer)) ids.push(this.state.drawer)
    const key = ids.join(',')
    if (key !== this.visible) { this.visible = key; if (this.props.onVisible) this.props.onVisible(ids) }
  }
  filtered(): SalaryRow[] {
    const q = this.state.q.trim().toLowerCase(), dept = this.state.dept
    return (this.props.employees || []).filter((e: SalaryRow) => (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) && (!dept || e.dept === dept))
  }
  pageRows(): SalaryRow[] {
    const rows = this.filtered(), totalPages = Math.max(1, Math.ceil(rows.length / this.state.size)), page = Math.min(this.state.page, totalPages - 1)
    return rows.slice(page * this.state.size, page * this.state.size + this.state.size)
  }
  openFor(id: string) {
    const st: StructureInfo | null | undefined = (this.props.structures || {})[id]
    this.setState({ drawer: id, fMonthly: st ? String(Math.round(st.gross)) : '', fDate: st ? this.props.nextMonthStart : this.props.monthStart })
  }
  renderVals() {
    const p = this.props, s = this.state, go = p.onGo || (() => {}), mobile = !!p.mobile, canEdit = !!p.canEdit
    const st = p.state || 'live', isLoading = st === 'loading', isError = st === 'error'
    const all: SalaryRow[] = p.employees || [], S: Record<string, StructureInfo | null | undefined> = p.structures || {}, calc: PayCalc | undefined = p.calc
    const isEmpty = !isLoading && !isError && all.length === 0, live = !isLoading && !isError && !isEmpty
    const rows = this.filtered()
    const totalPages = Math.max(1, Math.ceil(rows.length / s.size)), page = Math.min(s.page, totalPages - 1)
    const newIds: string[] = p.newIds || []
    const pageRows = rows.slice(page * s.size, page * s.size + s.size).map((e) => {
      const x = S[e.id]
      return {
        id: e.id, code: e.code, name: e.name, dept: e.dept, isNew: newIds.includes(e.id), has: !!x, pending: x === undefined,
        basicL: x ? inr(x.basic) : x === undefined ? '…' : 'No structure', hraL: x ? inr(x.hra) : '—', specialL: x ? inr(x.special) : '—',
        dedL: x ? inr(x.deductions) : '—', dedCodes: x ? x.dedCodes.join(', ') : '', netL: x ? inr(x.net) : '—',
        onEdit: () => this.openFor(e.id),
      }
    })
    const depts = [...new Set(all.map((e) => e.dept).filter(Boolean))].sort()
    const num = (v: string, dim?: boolean) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', color: dim ? '#94a3b8' : undefined } }, v)
    const columns = [
      { key: 'name', header: 'Employee', render: (r: any) => createElement('div', { style: { display: 'grid', gap: 1 } }, createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, createElement('strong', { style: { fontWeight: 600, color: '#0f172a' } }, r.name), r.isNew ? createElement(HrStatusPill, { tone: 'ok' } as any, 'New') : null), createElement('span', { style: { fontSize: 12, color: '#64748b' } }, [r.code, r.dept].filter(Boolean).join(' · '))) },
      { key: 'basic', header: 'Basic pay', render: (r: any) => num(r.basicL, !r.has) },
      { key: 'hra', header: 'HRA', render: (r: any) => num(r.hraL, !r.has) },
      { key: 'special', header: 'Special allowance', render: (r: any) => num(r.specialL, !r.has) },
      { key: 'ded', header: 'Deductions', render: (r: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', color: r.has ? undefined : '#94a3b8' } }, r.dedL, r.dedCodes ? createElement('span', { style: { color: '#64748b', fontSize: 12 } }, ` (${r.dedCodes})`) : null) },
      { key: 'net', header: 'Net payable', render: (r: any) => createElement('strong', { style: { color: r.has ? '#0f6e56' : '#94a3b8', fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, r.netL) },
      { key: 'act', header: '', render: (r: any) => (canEdit ? createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' }, onClick: (e: any) => e.stopPropagation() }, createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: r.onEdit, disabled: r.pending, 'data-tip': r.has ? `Edit ${r.name}’s salary structure` : `Add a salary structure for ${r.name}` } as any, dashIcon(r.has ? 'pencil' : 'plus', 14), r.has ? ' Edit' : ' Add')) : null) },
    ]
    const missing = (p.missing || []).filter((k: any) => !newIds.includes(k.id)).map((k: any) => ({ ...k, onAdd: () => this.openFor(k.id) }))
    // Drawer.
    const d = s.drawer ? all.find((e) => e.id === s.drawer) || (p.missing || []).find((k: any) => k.id === s.drawer) : null
    const cur = s.drawer ? S[s.drawer] : undefined, isNew = !cur, m = Number(s.fMonthly) || 0, fBad = m <= 0
    const split = !isNew && cur ? scaleSplit(cur.earnings, m) : null, ds = designSplit(m)
    const earn = split
      ? split.map((l) => [l.code, l.amount] as [string, number])
      : [['BASIC', ds.BASIC], ['HRA', ds.HRA], ['SPECIAL', ds.SPECIAL], ['CONVEYANCE', ds.CONVEYANCE]].filter(([, v]) => (v as number) > 0) as [string, number][]
    const NAME: Record<string, string> = { BASIC: 'Basic pay', HRA: 'House rent allowance', SPECIAL: 'Special allowance', CONVEYANCE: 'Conveyance', OTHER_ALLOWANCE: 'Other allowance' }
    const basic = earn.find(([c]) => c === 'BASIC')?.[1] ?? 0
    const pf = calc && calc.pfOn ? Math.round((calc.pfApplyCeil ? Math.min(basic, calc.pfCeil) : basic) * calc.pfEmp / 100) : 0
    const esi = calc && calc.esiOn && m <= calc.esiCeil ? Math.round(m * calc.esiEmp / 100) : 0
    const pt = calc ? calc.ptFor(m) : 0
    const preview = [
      ...earn.map(([c, v]) => ({ k: NAME[c] || c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' '), v: inr(v) })),
      ...(pf ? [{ k: 'Provident fund (PF)', v: '− ' + inr(pf) }] : []),
      ...(esi ? [{ k: 'ESI', v: '− ' + inr(esi) }] : []),
      ...(pt ? [{ k: 'Professional tax', v: '− ' + inr(pt) }] : []),
      { k: 'Income tax (TDS)', v: 'Not calculated yet' },
    ]
    const closeDrawer = () => { if (!s.busy) this.setState({ drawer: null }) }
    const save = async () => {
      if (!d || fBad || s.busy || !p.onSave) return
      this.setState({ busy: true })
      try {
        const ok = await p.onSave({ employeeId: d.id, name: d.name, monthly: m, effectiveFrom: s.fDate, isNew, lines: split, current: cur || null })
        if (ok !== false) this.setState({ drawer: null, notice: isNew && (p.missing || []).some((k: any) => k.id === d.id) ? d.id : null })
      } finally { this.setState({ busy: false }) }
    }
    const dFooter = d ? createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' } },
      createElement(HrButton, { variant: 'ghost', onClick: closeDrawer } as any, 'Cancel'),
      createElement(HrButton, { onClick: save, disabled: fBad || s.busy || !canEdit } as any, s.busy ? 'Saving…' : isNew ? 'Add structure' : 'Save changes')) : null
    const b = s.bulk || { pct: '5', dept: '', date: p.nextMonthStart }
    const noticeRow = s.notice ? (p.missing || []).find((k: any) => k.id === s.notice) : null
    return {
      isLoading, isError, isEmpty, live, isDesktop: !mobile, isMobile: mobile, pageRows, columns, noRows: pageRows.length === 0, openRow: (r: any) => canEdit && r.onEdit(),
      search: { value: s.q, onChange: (v: string) => this.setState({ q: v, page: 0 }), placeholder: 'Find a person or EMP code…' },
      filters: [{ key: 'dept', allLabel: 'All departments', value: s.dept, options: depts.map((x) => ({ value: x, label: x })), onChange: (v: string) => this.setState({ dept: v, page: 0 }) }],
      clear: () => this.setState({ q: '', dept: '', page: 0 }),
      // Exporting every structure needs a list endpoint; the button stays, marked.
      actions: createElement(HrButton, { variant: 'ghost', size: 'sm', disabled: true, 'data-tip': 'Coming soon' } as any, dashIcon('download', 14), ' Export'),
      pager: createElement(HrPagination as any, { page, pageSize: s.size, totalElements: rows.length, totalPages, pageSizeOptions: [10, 25, 50], onPageChange: (n: number) => this.setState({ page: n }), onPageSizeChange: (n: number) => this.setState({ size: n, page: 0 }) }),
      hasMissing: missing.length > 0, missing, missingTitle: `${missing.length === 1 ? '1 person has' : missing.length + ' people have'} no salary structure`,
      hasNotice: !!noticeRow, noticeName: noticeRow ? noticeRow.name : '', dismiss: () => this.setState({ notice: null }),
      openRun: () => (p.runId ? go('runs', { runId: p.runId }) : go('runs')), runLabel: p.runLabel || 'next', runTip: p.runId ? `Opens the ${p.runLabel} payroll run` : 'Opens Processing & Payslips',
      drawerOpen: !!d, dTitle: isNew ? 'Add salary structure' : 'Edit salary structure', dName: d ? d.name : '', dCode: d ? d.code : '', dMeta: d ? [d.dept, (d as any).role].filter(Boolean).join(' · ') : '', dFooter, closeDrawer,
      fMonthly: s.fMonthly, setMonthly: (e: any) => this.setState({ fMonthly: e.target.value.replace(/[^\d]/g, '') }), fBad, fDate: s.fDate, setDate: (e: any) => this.setState({ fDate: e && e.target ? e.target.value : e }),
      fDateMin: p.monthStart, minNote: 'Enter the monthly gross pay.',
      splitNote: isNew ? 'Basic is 50% of gross, HRA is 40% of basic, conveyance is ₹1,600 from ₹20,000, and the rest is special allowance. PF, ESI and PT follow your payroll settings.'
        : 'Each part of the current structure changes in proportion. PF, ESI and PT follow your payroll settings.',
      preview, pNet: inr(Math.max(0, m - pf - esi - pt)),
      // Bulk revision needs a backend endpoint: the form shows, Apply stays off.
      openBulk: () => this.setState({ bulk: { pct: '5', dept: '', date: p.nextMonthStart } }), bulkOpen: !!s.bulk, setBulkOpen: (o: boolean) => { if (!o) this.setState({ bulk: null }) }, closeBulk: () => this.setState({ bulk: null }),
      bPct: b.pct, setPct: (e: any) => this.setState({ bulk: { ...b, pct: e.target.value } }), bDept: b.dept, setBDept: (v: any) => this.setState({ bulk: { ...b, dept: v && v.target ? v.target.value : v } }),
      bDate: b.date, bDateMin: p.nextMonthStart, setBDate: (e: any) => this.setState({ bulk: { ...b, date: e && e.target ? e.target.value : e } }), bBad: true, applyBulk: () => {},
      deptOptions: [{ value: '', label: 'Everyone' }, ...depts.map((x) => ({ value: x, label: x }))],
      bPreview: 'Coming soon — revising many structures at once isn’t available yet. Edit each person’s structure for now.',
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('users'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() }, emptyAction: { label: 'Back to runs', onClick: () => go('runs') },
      skA: { style: { height: 90, width: '100%', borderRadius: 16 } }, skB: { style: { height: 360, width: '100%', borderRadius: 16 } },
      icTrend: dashIcon('trendingUp', 15), icPlus: dashIcon('plus', 14), icAlert: dashIcon('alert', 20), icOk: dashIcon('checkCircle', 20), icX: dashIcon('x', 16),
    }
  }
  render() { return dc(this, PaySalaryView, 'PaySalary') }
}
