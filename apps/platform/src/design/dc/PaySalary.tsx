// Salary Structure — ported from the design component PaySalary.dc.html.
// Rows are the directory plus each person's current structure (GET
// /v1/payroll/structures/employee/{id}, fetched for the visible page). Saving
// creates a new structure revision (POST /v1/payroll/structures). A new person
// gets the design's split; an existing structure keeps its own proportions.
// Export downloads every current structure (GET /v1/payroll/structures/export).
// Bulk revise CTC previews then applies a revision for a group of people
// (POST /v1/payroll/structures/bulk-revise[/preview]); the slots the design's
// modal gained for it are built from the same field styles and the module kit.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PaySalaryView } from './PaySalary.view'
import { HrButton, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { Facts as KitFacts, Note as KitNote, Row as KitRow, RowList as KitRowList } from '@/design/module/ModuleKit'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'
import { fmtShort } from './dates'

export interface StructureInfo {
  gross: number; net: number; ctcAnnual: number; effectiveFrom: string
  basic: number; hra: number; special: number; deductions: number; dedCodes: string[]
  /** EARNING lines with a component, as saved. */
  earnings: { componentId: string; code: string; amount: number }[]
}
export interface PayCalc { pfOn: boolean; pfEmp: number; pfCeil: number; pfApplyCeil: boolean; esiOn: boolean; esiEmp: number; esiCeil: number; ptFor: (gross: number) => number }
export interface SalaryRow { id: string; code: string; name: string; dept: string; role: string }

/** GET /v1/payroll/structures/bulk-revise/options — who can be revised (people with a structure). */
export interface BulkOption { id: string; label: string; people: number }
export interface BulkOptions {
  companies: BulkOption[]; departments: BulkOption[]; designations: BulkOption[]; grades: BulkOption[]
  people: { id: string; employeeCode: string; name: string; department: string | null; ctcAnnual: number }[]
  withoutStructure: number
}
/** POST /v1/payroll/structures/bulk-revise/preview */
export interface BulkPreview {
  rows: { employeeId: string; employeeCode: string; name: string; department: string | null; oldCtc: number; newCtc: number; difference: number; oldMonthlyGross: number; newMonthlyGross: number }[]
  skipped: { employeeId: string; employeeCode: string; name: string; reason: string; detail: string }[]
  employees: number; totalOldCtc: number; totalNewCtc: number; totalDifference: number; effectiveFrom: string; change: string
  blockers: string[]; previewKey: string
}
export interface BulkBody {
  mode: 'PERCENT' | 'AMOUNT'; value: number; effectiveFrom: string
  companyId?: string; departmentId?: string; designationId?: string; grade?: string; employeeIds?: string[]
  reason?: string; previewKey?: string
}

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

/** The design's own field and input styles (copied from the modal), for the slots it gained. */
const FIELD = { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 } as const
const INPUT = { font: 'inherit', fontWeight: 500, height: 42, padding: '0 12px', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none' } as const
const HINT = { fontSize: 12, fontWeight: 400, color: '#64748b' } as const
// Kit parts used through createElement (the logic files don't use JSX).
const Facts = KitFacts as any, Note = KitNote as any, Row = KitRow as any, RowList = KitRowList as any
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const newBulk = (date: string) => ({ mode: 'PERCENT', pct: '5', amount: '', dept: '', date, reason: '', picked: [] as string[], q: '' })

export class PaySalary extends DCLogic {
  state: any = { q: '', dept: '', page: 0, size: 10, drawer: null, fMonthly: '', fDate: '', bulk: null, notice: null, busy: false,
    bOpts: null, bOptsErr: null, bPrev: null, bErr: null, bLoading: false, bBusy: false, exporting: false }
  private focused = ''
  private visible = ''
  private reqKey = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  componentDidMount() { this.follow(); this.report() }
  componentDidUpdate() { this.follow(); this.report(); this.schedulePreview() }
  componentWillUnmount() { clearTimeout(this.timer) }
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

  // ── Bulk revise CTC ──
  openBulk() {
    this.reqKey = ''
    this.setState({ bulk: newBulk(this.props.nextMonthStart), bPrev: null, bErr: null, bLoading: false })
    if (!this.state.bOpts && this.props.loadBulkOptions) {
      this.setState({ bOptsErr: null })
      this.props.loadBulkOptions().then((o: BulkOptions) => this.setState({ bOpts: o }), (e: unknown) => this.setState({ bOptsErr: errText(e) }))
    }
  }
  closeBulk() { if (!this.state.bBusy) { clearTimeout(this.timer); this.reqKey = ''; this.setState({ bulk: null }) } }
  /** What the form asks for, or why it can't be previewed yet. */
  bulkParams(): { body: BulkBody | null; key: string; error: string } {
    const b = this.state.bulk
    if (!b) return { body: null, key: '', error: '' }
    const mode = b.mode === 'AMOUNT' ? 'AMOUNT' : 'PERCENT', value = Number(mode === 'AMOUNT' ? b.amount : b.pct)
    if (!(value > 0)) return { body: null, key: '', error: mode === 'AMOUNT' ? 'Enter the yearly increase in rupees.' : 'Enter the increase in percent.' }
    if (mode === 'PERCENT' && value > 100) return { body: null, key: '', error: 'A percentage increase can be at most 100%.' }
    if (mode === 'AMOUNT' && value > 10000000) return { body: null, key: '', error: 'A fixed increase can be at most ₹1,00,00,000 a year.' }
    if (!b.date) return { body: null, key: '', error: 'Choose the date the new pay starts.' }
    if (!b.date.endsWith('-01')) return { body: null, key: '', error: 'Choose the 1st of a month: payroll pays a whole month from one salary structure.' }
    const body: BulkBody = { mode, value, effectiveFrom: b.date }
    const [kind, id] = String(b.dept || '').split(/:(.*)/s)
    if (kind === 'co') body.companyId = id
    else if (kind === 'dept') body.departmentId = id
    else if (kind === 'desig') body.designationId = id
    else if (kind === 'grade') body.grade = id
    else if (kind === 'pick') {
      if (!b.picked.length) return { body: null, key: '', error: 'Choose at least one person.' }
      body.employeeIds = [...b.picked].sort()
    }
    return { body, key: JSON.stringify(body), error: '' }
  }
  schedulePreview() {
    const prm = this.bulkParams()
    if (!this.state.bulk || !prm.body || prm.key === this.reqKey || !this.props.previewBulk) return
    this.reqKey = prm.key
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const key = prm.key
      this.setState({ bLoading: true })
      this.props.previewBulk(prm.body).then(
        (d: BulkPreview) => { if (this.reqKey === key) this.setState({ bPrev: { key, data: d }, bErr: null, bLoading: false }) },
        (e: unknown) => { if (this.reqKey === key) this.setState({ bPrev: null, bErr: errText(e), bLoading: false }) },
      )
    }, 350)
  }
  async applyBulk() {
    const s = this.state, prm = this.bulkParams(), prev: BulkPreview | null = s.bPrev && s.bPrev.key === prm.key ? s.bPrev.data : null
    if (!prm.body || !prev || s.bBusy || !this.props.applyBulk) return
    this.setState({ bBusy: true })
    try {
      const ok = await this.props.applyBulk({ ...prm.body, reason: s.bulk.reason.trim(), previewKey: prev.previewKey }, prev)
      if (ok !== false) { this.reqKey = ''; this.setState({ bulk: null, bOpts: null }) }
      else { this.reqKey = ''; this.setState({ bPrev: null }) } // look again: the numbers may have changed
    } finally { this.setState({ bBusy: false }) }
  }
  bulkVals() {
    const p = this.props, s = this.state, b = s.bulk || newBulk(p.nextMonthStart), o: BulkOptions | null = s.bOpts
    const setB = (patch: Record<string, unknown>) => this.setState({ bulk: { ...b, ...patch } })
    const val = (e: any) => (e && e.target ? e.target.value : e)
    const prm = this.bulkParams(), prev: BulkPreview | null = s.bPrev && s.bPrev.key === prm.key ? s.bPrev.data : null
    const amountMode = b.mode === 'AMOUNT'
    const count = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
    // "Who": everyone, or one company / department / designation / grade, or hand-picked people.
    const opts = [{ value: '', label: o ? `Everyone with a salary structure (${o.people.length})` : 'Everyone' }]
    if (o) {
      if (o.companies.length > 1) o.companies.forEach((x) => opts.push({ value: `co:${x.id}`, label: `Company · ${x.label} (${x.people})` }))
      o.departments.forEach((x) => opts.push({ value: `dept:${x.id}`, label: `Department · ${x.label} (${x.people})` }))
      o.designations.forEach((x) => opts.push({ value: `desig:${x.id}`, label: `Designation · ${x.label} (${x.people})` }))
      o.grades.forEach((x) => opts.push({ value: `grade:${x.id}`, label: `Grade · ${x.label} (${x.people})` }))
      if (o.people.length) opts.push({ value: 'pick', label: 'Choose people…' })
    }
    // Hand-picked people: a search box and the list of people who have a structure.
    let whoBlock = null
    if (b.dept === 'pick' && o) {
      const q = b.q.trim().toLowerCase()
      const shown = o.people.filter((x) => !q || x.name.toLowerCase().includes(q) || x.employeeCode.toLowerCase().includes(q))
      const toggle = (id: string) => setB({ picked: b.picked.includes(id) ? b.picked.filter((x: string) => x !== id) : [...b.picked, id] })
      whoBlock = createElement('div', { style: FIELD },
        createElement('span', null, 'People *'),
        createElement('input', { type: 'search', value: b.q, onChange: (e: any) => setB({ q: e.target.value }), placeholder: 'Find a person or EMP code…', 'aria-label': 'Find a person or EMP code', style: INPUT, className: 'dc-pay-salary-1' }),
        createElement('div', { style: { maxHeight: 220, overflowY: 'auto', borderRadius: 16 } },
          createElement(RowList, null, shown.length ? shown.map((x) => {
            const on = b.picked.includes(x.id)
            return createElement(Row, {
              key: x.id, onClick: () => toggle(x.id), title: x.name, meta: [x.employeeCode, x.department].filter(Boolean).join(' · '),
              trail: on ? createElement(HrStatusPill, { tone: 'ok' } as any, 'Selected') : createElement('span', { style: HINT }, inr(x.ctcAnnual) + ' a year'),
            })
          }) : createElement(Row, { title: 'No one matches', meta: 'Only people with a salary structure can be revised.', muted: true }))),
        createElement('span', { style: HINT }, b.picked.length ? `${count(b.picked.length)} selected. Tap a name to add or remove.` : 'Tap a name to add it.'))
    }
    const modeBlock = createElement('div', { style: FIELD },
      createElement('span', null, 'Revise by'),
      createElement(HrSelect, { value: b.mode, onChange: (v: string) => setB({ mode: v }), options: [{ value: 'PERCENT', label: 'A percentage of CTC' }, { value: 'AMOUNT', label: 'A fixed amount a year (₹)' }] }))
    const reasonBlock = createElement('label', { style: FIELD },
      'Reason *',
      createElement('input', { type: 'text', value: b.reason, maxLength: 500, onChange: (e: any) => setB({ reason: e.target.value }), placeholder: 'e.g. Annual increment 2026', style: INPUT, className: 'dc-pay-salary-1' }),
      createElement('span', { style: HINT }, 'Saved on each new salary structure and in the audit log.'))

    // The green line: what the revision does, or what's missing.
    const reasonOk = b.reason.trim().length >= 3
    const preview = s.bOptsErr ? `Couldn’t load who can be revised: ${s.bOptsErr}`
      : !o ? 'Loading who can be revised…'
        : prm.error ? prm.error
          : s.bErr ? s.bErr
            : !prev ? 'Working out the new pay…'
              : prev.rows.length === 0 ? 'No one in this selection can be revised.'
                : `${count(prev.employees)} · annual CTC goes up by ${inr(prev.totalDifference)} (${inr(prev.totalDifference / 12)} a month) from ${fmtShort(prev.effectiveFrom)}.`
    let previewBlock = null
    if (prev) {
      const parts: any[] = []
      prev.blockers.forEach((t, i) => parts.push(createElement(Note, { key: `b${i}`, tone: 'red' }, t)))
      if (prev.rows.length) {
        parts.push(createElement(Facts, { key: 'facts', min: 150, items: [
          { k: 'People', v: String(prev.employees) }, { k: 'Change', v: prev.change },
          { k: 'Current CTC', v: inr(prev.totalOldCtc) }, { k: 'New CTC', v: inr(prev.totalNewCtc) },
        ] }))
        parts.push(createElement('div', { key: 'rows', style: { maxHeight: 240, overflowY: 'auto', borderRadius: 16 } },
          createElement(RowList, null, prev.rows.map((r) => createElement(Row, {
            key: r.employeeId, title: r.name, meta: `${[r.employeeCode, r.department].filter(Boolean).join(' · ')} · ${inr(r.oldCtc)} → ${inr(r.newCtc)} a year`,
            trail: createElement(HrStatusPill, { tone: 'ok' } as any, `+${inr(r.difference)}`),
          })))))
      }
      if (prev.skipped.length) {
        const list = prev.skipped.slice(0, 5).map((k) => `${k.name} (${k.employeeCode}): ${k.detail}`).join(' ')
        parts.push(createElement(Note, { key: 'skip' }, `Not changed (${prev.skipped.length}): ${list}${prev.skipped.length > 5 ? ` And ${prev.skipped.length - 5} more.` : ''}`))
      }
      if (prev.rows.length && !prev.blockers.length) {
        parts.push(createElement(Note, { key: 'warn', tone: 'amber' },
          `Applying saves a new salary structure for ${count(prev.employees)} from ${fmtShort(prev.effectiveFrom)}, and tells each of them their salary was revised. Payroll uses the new pay from that month’s run. There is no bulk undo: to reverse it, edit each person’s structure.`))
      }
      previewBlock = createElement('div', { style: { display: 'grid', gap: 10 } }, ...parts)
    }
    const bad = !prev || !prev.rows.length || prev.blockers.length > 0 || !reasonOk || s.bBusy || s.bLoading || !!prm.error
    return {
      canBulk: !!p.canBulk,
      openBulk: () => this.openBulk(), bulkOpen: !!s.bulk, setBulkOpen: (open: boolean) => { if (!open) this.closeBulk() }, closeBulk: () => this.closeBulk(),
      bModeBlock: modeBlock, bValueLabel: amountMode ? 'Increase CTC by (₹ a year) *' : 'Increase by (%) *',
      bMin: amountMode ? '500' : '0.5', bMax: amountMode ? '10000000' : '100', bStep: amountMode ? '500' : '0.5',
      bPct: amountMode ? b.amount : b.pct, setPct: (e: any) => setB(amountMode ? { amount: val(e) } : { pct: val(e) }),
      bDept: b.dept, setBDept: (v: any) => setB({ dept: val(v) }), deptOptions: opts, bWhoBlock: whoBlock,
      bDate: b.date, bDateMin: p.monthStart, setBDate: (e: any) => setB({ date: val(e) }), bReasonBlock: reasonBlock,
      bPreview: preview, bPreviewBlock: previewBlock,
      bBad: bad, applyBulk: () => { this.applyBulk() }, bApplyLabel: s.bBusy ? 'Applying…' : 'Apply revision',
    }
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
    // A structure with no component lines is paid as basic = monthly CTC, and stays that way.
    const earn = split
      ? split.length ? split.map((l) => [l.code, l.amount] as [string, number]) : ([['BASIC', m]] as [string, number][])
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
    const noticeRow = s.notice ? (p.missing || []).find((k: any) => k.id === s.notice) : null
    const exportAll = async () => {
      if (s.exporting || !p.onExport) return
      this.setState({ exporting: true })
      try { await p.onExport() } finally { this.setState({ exporting: false }) }
    }
    return {
      isLoading, isError, isEmpty, live, isDesktop: !mobile, isMobile: mobile, pageRows, columns, noRows: pageRows.length === 0, openRow: (r: any) => canEdit && r.onEdit(),
      search: { value: s.q, onChange: (v: string) => this.setState({ q: v, page: 0 }), placeholder: 'Find a person or EMP code…' },
      filters: [{ key: 'dept', allLabel: 'All departments', value: s.dept, options: depts.map((x) => ({ value: x, label: x })), onChange: (v: string) => this.setState({ dept: v, page: 0 }) }],
      clear: () => this.setState({ q: '', dept: '', page: 0 }),
      // Every current structure with its components, as an Excel workbook.
      actions: createElement(HrButton, {
        variant: 'ghost', size: 'sm', disabled: !p.canExport || s.exporting, onClick: exportAll,
        'data-tip': p.canExport ? 'Downloads every salary structure (Excel)' : 'Needs permission to view salary structures',
      } as any, dashIcon('download', 14), s.exporting ? ' Preparing…' : ' Export'),
      pager: createElement(HrPagination as any, { page, pageSize: s.size, totalElements: rows.length, totalPages, pageSizeOptions: [10, 25, 50], onPageChange: (n: number) => this.setState({ page: n }), onPageSizeChange: (n: number) => this.setState({ size: n, page: 0 }) }),
      hasMissing: missing.length > 0, missing, missingTitle: `${missing.length === 1 ? '1 person has' : missing.length + ' people have'} no salary structure`,
      hasNotice: !!noticeRow, noticeName: noticeRow ? noticeRow.name : '', dismiss: () => this.setState({ notice: null }),
      openRun: () => (p.runId ? go('runs', { runId: p.runId }) : go('runs')), runLabel: p.runLabel || 'next', runTip: p.runId ? `Opens the ${p.runLabel} payroll run` : 'Opens Processing & Payslips',
      drawerOpen: !!d, dTitle: isNew ? 'Add salary structure' : 'Edit salary structure', dName: d ? d.name : '', dCode: d ? d.code : '', dMeta: d ? [d.dept, (d as any).role].filter(Boolean).join(' · ') : '', dFooter, closeDrawer,
      fMonthly: s.fMonthly, setMonthly: (e: any) => this.setState({ fMonthly: e.target.value.replace(/[^\d]/g, '') }), fBad, fDate: s.fDate, setDate: (e: any) => this.setState({ fDate: e && e.target ? e.target.value : e }),
      fDateMin: p.monthStart, minNote: 'Enter the monthly gross pay.',
      splitNote: isNew ? 'Basic is 50% of gross, HRA is 40% of basic, conveyance is ₹1,600 from ₹20,000, and the rest is special allowance. PF, ESI and PT follow your payroll settings.'
        : split && !split.length ? 'This structure has no separate components, so payroll pays it all as basic. PF, ESI and PT follow your payroll settings.'
          : 'Each part of the current structure changes in proportion. PF, ESI and PT follow your payroll settings.',
      preview, pNet: inr(Math.max(0, m - pf - esi - pt)),
      ...this.bulkVals(),
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('users'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() }, emptyAction: { label: 'Back to runs', onClick: () => go('runs') },
      skA: { style: { height: 90, width: '100%', borderRadius: 16 } }, skB: { style: { height: 360, width: '100%', borderRadius: 16 } },
      icTrend: dashIcon('trendingUp', 15), icPlus: dashIcon('plus', 14), icAlert: dashIcon('alert', 20), icOk: dashIcon('checkCircle', 20), icX: dashIcon('x', 16),
    }
  }
  render() { return dc(this, PaySalaryView, 'PaySalary') }
}
