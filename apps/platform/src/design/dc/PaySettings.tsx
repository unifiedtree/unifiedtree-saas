// Payroll Settings — ported from the design component PaySettings.dc.html.
// Reads and saves GET/PUT /v1/payroll/settings; PT slabs come from
// /v1/payroll/pt-slabs/{state}. The API has no switch for the payroll cycle, so
// that card's switch stays on; TDS is "coming soon", as designed.
// Payroll uses all of it (V143.11): runs cover the cycle (from the start day to
// the day before the next start, so the end day follows the start day), the
// processing day sets each run's pay date, and LWF is deducted in the months
// chosen here.
import { createElement, createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PaySettingsView } from './PaySettings.view'
import { Field, Input } from '@unifiedtree/ui-kit'
import { HrSelect } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'

export interface ApiPayrollSettings {
  pfEnabled: boolean; pfEmployeePercent: number; pfEmployerPercent: number; pfWageCeiling: number; pfApplyCeiling: boolean; pfEstablishmentCode?: string | null
  esiEnabled: boolean; esiEmployeePercent: number; esiEmployerPercent: number; esiWageCeiling: number; esiEstablishmentCode?: string | null
  ptEnabled: boolean; ptStateCode?: string | null; lwfEnabled: boolean; lwfEmployeeAmount: number; lwfEmployerAmount: number
  sandwichRuleEnabled: boolean; lateMarkLopThreshold?: number | null; payrollCycleStartDay: number; payrollCycleEndDay: number; salaryProcessingDay: number
  /** Months (1-12) whose payroll runs deduct LWF. */
  lwfDeductionMonths?: number[] | null
}
export const PT_STATES: [string, string][] = [['KA', 'Karnataka'], ['MH', 'Maharashtra'], ['TN', 'Tamil Nadu'], ['TS', 'Telangana'], ['AP', 'Andhra Pradesh'], ['WB', 'West Bengal'], ['GJ', 'Gujarat'], ['KL', 'Kerala']]
const nameOf = (code?: string | null) => PT_STATES.find(([c]) => c === code)?.[1] || ''
const codeOf = (name: string) => PT_STATES.find(([, n]) => n === name)?.[0] || ''
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The LWF schedules states use: half-yearly (most), yearly in December, or monthly. Stored as months "6,12". */
export const LWF_SCHEDULES: [string, string][] = [['6,12', 'June and December'], ['12', 'December only (yearly)'], ['1,2,3,4,5,6,7,8,9,10,11,12', 'Every month']]
const monthsKey = (m?: number[] | null) => (m && m.length ? [...m].sort((a, b) => a - b).join(',') : '6,12')
export const lwfMonthsLabel = (key: string) => LWF_SCHEDULES.find(([k]) => k === key)?.[1] || key.split(',').filter(Boolean).map((n) => MONTH_NAMES[Number(n) - 1]?.slice(0, 3)).join(', ')
/** The cycle ends the day before it starts again. */
const endFor = (start: string) => (/^\d{1,2}$/.test(start) && +start >= 1 && +start <= 31 ? String(+start === 1 ? 31 : +start - 1) : '')

type Form = {
  pf: { on: boolean; emp: string; er: string; ceiling: string; applyCeiling: boolean; code: string }
  esi: { on: boolean; emp: string; er: string; ceiling: string; code: string }
  pt: { on: boolean; state: string }
  lwf: { on: boolean; emp: string; er: string; months: string }
  cycle: { on: boolean; start: string; end: string; proc: string; sandwich: boolean; late: string }
}
export function formOf(a: ApiPayrollSettings): Form {
  return {
    pf: { on: !!a.pfEnabled, emp: str(a.pfEmployeePercent), er: str(a.pfEmployerPercent), ceiling: str(a.pfWageCeiling), applyCeiling: !!a.pfApplyCeiling, code: a.pfEstablishmentCode || '' },
    esi: { on: !!a.esiEnabled, emp: str(a.esiEmployeePercent), er: str(a.esiEmployerPercent), ceiling: str(a.esiWageCeiling), code: a.esiEstablishmentCode || '' },
    pt: { on: !!a.ptEnabled, state: nameOf(a.ptStateCode) },
    lwf: { on: !!a.lwfEnabled, emp: str(a.lwfEmployeeAmount), er: str(a.lwfEmployerAmount), months: monthsKey(a.lwfDeductionMonths) },
    cycle: { on: true, start: str(a.payrollCycleStartDay), end: endFor(str(a.payrollCycleStartDay)) || str(a.payrollCycleEndDay), proc: str(a.salaryProcessingDay), sandwich: !!a.sandwichRuleEnabled, late: str(a.lateMarkLopThreshold) },
  }
}
export function apiOf(f: Form): ApiPayrollSettings {
  const n = (v: string) => Number(v || 0)
  return {
    pfEnabled: f.pf.on, pfEmployeePercent: n(f.pf.emp), pfEmployerPercent: n(f.pf.er), pfWageCeiling: n(f.pf.ceiling), pfApplyCeiling: f.pf.applyCeiling, pfEstablishmentCode: f.pf.code,
    esiEnabled: f.esi.on, esiEmployeePercent: n(f.esi.emp), esiEmployerPercent: n(f.esi.er), esiWageCeiling: n(f.esi.ceiling), esiEstablishmentCode: f.esi.code,
    ptEnabled: f.pt.on, ptStateCode: codeOf(f.pt.state) || null, lwfEnabled: f.lwf.on, lwfEmployeeAmount: n(f.lwf.emp), lwfEmployerAmount: n(f.lwf.er),
    lwfDeductionMonths: f.lwf.months.split(',').filter(Boolean).map(Number),
    sandwichRuleEnabled: f.cycle.sandwich, lateMarkLopThreshold: f.cycle.late === '' ? null : n(f.cycle.late),
    payrollCycleStartDay: n(f.cycle.start), payrollCycleEndDay: n(f.cycle.end), salaryProcessingDay: n(f.cycle.proc),
  }
}

export class PaySettings extends DCLogic {
  state: any = { form: null, attempted: false, saving: false, active: 'pf', leaveOpen: false, toast: null, w: typeof window !== 'undefined' ? Math.max(320, window.innerWidth - 150) : 1200 }
  rootRef = createRef<HTMLDivElement>()
  private ro?: ResizeObserver
  private raf = 0
  private lockUntil = 0
  private dirty = false
  private proceed: (() => void) | null = null
  private errKeys: string[] = []
  private ptReported = '\u0000'
  private tt?: ReturnType<typeof setTimeout>
  private jt?: ReturnType<typeof setTimeout>
  private guard = (proceed: () => void) => { if (!this.dirty) return false; this.proceed = proceed; this.setState({ leaveOpen: true }); return true }
  private onScroll = () => { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.spy() }) }
  componentDidMount() {
    const el = this.rootRef.current
    if (el && typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && Math.abs(w - this.state.w) > 4) this.setState({ w }) })
      this.ro.observe(el)
    }
    // The app scrolls inside the shell's main area, not the window.
    this.scroller()?.addEventListener('scroll', this.onScroll, { passive: true })
    window.__utLeaveGuard = this.guard
    this.reportPt()
  }
  componentDidUpdate(_pp: any, ps: any) {
    if (ps && ps.active !== this.state.active) {
      const root = this.rootRef.current, row = root && root.querySelector('[data-ps-chips]'), chip = row && row.querySelector('[data-chip="' + this.state.active + '"]') as HTMLElement | null
      if (row && chip && (row as any).scrollTo) (row as any).scrollTo({ left: Math.max(0, chip.offsetLeft - 16), behavior: 'smooth' })
    }
    this.reportPt()
  }
  componentWillUnmount() {
    this.ro?.disconnect()
    this.scroller()?.removeEventListener('scroll', this.onScroll)
    if (this.raf) cancelAnimationFrame(this.raf)
    if (window.__utLeaveGuard === this.guard) window.__utLeaveGuard = null
    clearTimeout(this.tt); clearTimeout(this.jt)
  }
  scroller(): HTMLElement | null {
    let el = this.rootRef.current?.parentElement || null
    while (el) { const o = getComputedStyle(el).overflowY; if (o === 'auto' || o === 'scroll') return el; el = el.parentElement }
    return null
  }
  saved(): Form | null { return this.props.settings ? formOf(this.props.settings) : null }
  form(): Form | null { return this.state.form || this.saved() }
  /** The PT slabs shown are for the state chosen in the form. */
  reportPt() { const f = this.form(), code = f && f.pt.on ? codeOf(f.pt.state) : ''; if (code !== this.ptReported) { this.ptReported = code; if (this.props.onPtState) this.props.onPtState(code) } }
  narrow() { return !!this.props.mobile || this.state.w < 720 }
  offset() { return this.narrow() ? 132 : 88 }
  spy = () => {
    if (this.lockUntil > Date.now()) return
    const keys = ['pf', 'esi', 'pt', 'lwf', 'cycle', 'tds'], line = this.offset() + 16, sc = this.scroller()
    const top0 = sc ? sc.getBoundingClientRect().top : 0
    let act: string | null = null
    keys.forEach((k) => { const el = document.getElementById('ps-' + k); if (!el) return; if (act === null) act = k; if (el.getBoundingClientRect().top - top0 - line <= 0) act = k })
    if (!act) return
    if (sc && sc.scrollTop > 0 && sc.clientHeight + sc.scrollTop >= sc.scrollHeight - 2) act = 'tds'
    if (act !== this.state.active) this.setState({ active: act })
  }
  jump = (k: string, sel?: string) => {
    const el = document.getElementById('ps-' + k), sc = this.scroller()
    if (!el) return
    this.lockUntil = Date.now() + 900
    this.setState({ active: k })
    if (sc) sc.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - this.offset()), behavior: 'smooth' })
    else window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - this.offset()), behavior: 'smooth' })
    const t = ((sel && el.querySelector(sel)) || el.querySelector('h2')) as HTMLElement | null
    if (t && t.focus) t.focus({ preventScroll: true })
  }
  showToast = (kind: string, title: string, msg?: string) => {
    clearTimeout(this.tt)
    this.setState({ toast: { kind, title, msg: msg || '' } })
    this.tt = setTimeout(() => this.setState({ toast: null }), kind === 'error' ? 8000 : 3200)
  }
  set = (sec: keyof Form, key: string, val: any) => this.setState((ss: any) => {
    const cur = ss.form || this.saved(), next = { ...cur[sec], [key]: val }
    // The cycle's end day always follows its start day.
    if (sec === 'cycle' && key === 'start') next.end = endFor(String(val))
    return { form: { ...cur, [sec]: next } }
  })
  save = async () => {
    if (this.state.saving) return
    const errs = this.errKeys
    if (errs.length) { this.setState({ attempted: true }); clearTimeout(this.jt); this.jt = setTimeout(() => this.jump(errs[0].split('.')[0], '[aria-invalid="true"]'), 40); return }
    const f = this.form()
    if (!f || !this.props.onSave) return
    this.setState({ saving: true })
    const r = await this.props.onSave(apiOf(f))
    if (r && r.ok) { this.setState({ saving: false, form: null, attempted: false }); this.dirty = false; this.showToast('ok', 'Payroll settings saved') }
    else { this.setState({ saving: false }); this.showToast('error', 'Couldn’t save payroll settings', `${r && r.message ? 'Server: “' + r.message + '” ' : ''}Your changes are still here.`) }
  }
  renderVals() {
    const p = this.props, s = this.state
    const access = p.access || 'view', noAccess = access === 'none'
    const st = p.state || 'live'
    const isLoading = !noAccess && (st === 'loading' || !p.settings && st !== 'error')
    const isError = !noAccess && !isLoading && st === 'error'
    const live = !noAccess && !isLoading && !isError
    const canEdit = live && access === 'edit', readOnly = live && access !== 'edit'
    const narrow = this.narrow(), set = this.set
    const saved: Form = this.saved() || formOf({ pfEnabled: false, pfEmployeePercent: 0, pfEmployerPercent: 0, pfWageCeiling: 0, pfApplyCeiling: false, esiEnabled: false, esiEmployeePercent: 0, esiEmployerPercent: 0, esiWageCeiling: 0, ptEnabled: false, lwfEnabled: false, lwfEmployeeAmount: 0, lwfEmployerAmount: 0, sandwichRuleEnabled: false, payrollCycleStartDay: 1, payrollCycleEndDay: 31, salaryProcessingDay: 28 })
    const f: Form = canEdit ? s.form || saved : saved

    const grp = (d: any) => (d === '' || d == null ? '' : Number(d).toLocaleString('en-IN'))
    const inr = (d: any) => '₹' + (grp(d) || '0')
    const ord = (n0: any) => { const n = +n0, v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as any)[n % 10] || 'th') }

    const PCT = 'Enter a percentage between 0 and 100', DAY = 'Day must be between 1 and 31', E: Record<string, string> = {}
    const pctBad = (v: string) => v === '' || isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100
    const dayOk = (v: string) => /^\d{1,2}$/.test(String(v)) && +v >= 1 && +v <= 31
    if (f.pf.on) {
      if (pctBad(f.pf.emp)) E['pf.emp'] = PCT
      if (pctBad(f.pf.er)) E['pf.er'] = PCT
      if (f.pf.applyCeiling && !(Number(f.pf.ceiling) > 0)) E['pf.ceiling'] = 'Enter a wage ceiling above ₹0'
      // The code is optional in the API; when given it must look like an EPFO code.
      if (f.pf.code && !/^[A-Z]{5}\d{10}$/.test(f.pf.code)) E['pf.code'] = 'Use 5 letters then 10 digits, like MHBAN0012345000'
    }
    if (f.esi.on) {
      if (pctBad(f.esi.emp)) E['esi.emp'] = PCT
      if (pctBad(f.esi.er)) E['esi.er'] = PCT
      if (!(Number(f.esi.ceiling) > 0)) E['esi.ceiling'] = 'Enter a wage ceiling above ₹0'
      if (f.esi.code && !/^\d{17}$/.test(f.esi.code)) E['esi.code'] = 'Enter the 17-digit ESI code'
    }
    if (f.pt.on && !f.pt.state) E['pt.state'] = 'Choose a state to apply PT'
    if (f.lwf.on) {
      if (f.lwf.emp === '') E['lwf.emp'] = 'Enter an amount — ₹0 is allowed'
      if (f.lwf.er === '') E['lwf.er'] = 'Enter an amount — ₹0 is allowed'
    }
    const c = f.cycle, daysOk = dayOk(c.start) && dayOk(c.end) && dayOk(c.proc)
    const a = +c.start, b = +c.end, x = +c.proc, inside = a <= b ? x >= a && x <= b : x >= a || x <= b
    if (c.on) {
      (['start', 'end', 'proc'] as const).forEach((k) => { if (!dayOk(c[k])) E['cycle.' + k] = DAY })
      if (daysOk && !inside) E['cycle.proc'] = 'Processing day must fall inside the cycle'
      if (c.late !== '' && !(/^\d+$/.test(c.late) && +c.late >= 1)) E['cycle.late'] = 'Enter a whole number of 1 or more, or leave it blank'
    }
    const chg = (k: string) => { const [sa, sb] = k.split('.'); return (f as any)[sa][sb] !== (saved as any)[sa][sb] }
    const shown = (k: string) => !!E[k] && (s.attempted || chg(k) || (k === 'cycle.proc' && (chg('cycle.start') || chg('cycle.end'))))
    const errKeys = Object.keys(E); this.errKeys = canEdit ? errKeys : []
    const visKeys = canEdit ? errKeys.filter(shown) : []
    const secErr: Record<string, number> = {}; visKeys.forEach((k) => { const sk = k.split('.')[0]; secErr[sk] = (secErr[sk] || 0) + 1 })
    const vis = (k: string) => (canEdit && shown(k) ? E[k] : undefined)

    let nChg = 0
    Object.keys(f).forEach((sk) => Object.keys((f as any)[sk]).forEach((k) => { if ((f as any)[sk][k] !== (saved as any)[sk][k]) nChg++ }))
    const dirty = canEdit && nChg > 0; this.dirty = dirty

    const affix = (t: string) => createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#64748b' } }, t)
    const mono = { fontFamily: "'JetBrains Mono',ui-monospace,SFMono-Regular,monospace", letterSpacing: '.02em' }
    const cPct = (v: string) => { let t = String(v).replace(/[^\d.]/g, ''); const i = t.indexOf('.'); if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2); return t.slice(0, 6) }
    const cNum = (n: number) => (v: string) => { const d = String(v).replace(/\D/g, '').slice(0, n); return d === '' ? '' : String(Number(d)) }
    const cCode = (v: string) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15)
    const cDigits = (n: number) => (v: string) => String(v).replace(/\D/g, '').slice(0, n)
    const fld = (k: string, label: string, o: any) => {
      if (!canEdit) return null
      const [sa, sb] = k.split('.'), raw = (f as any)[sa][sb]
      return createElement(Field as any, { label, hint: o.hint, error: vis(k) },
        createElement(Input as any, { value: o.money ? grp(raw) : raw, onChange: (e: any) => set(sa as keyof Form, sb, o.clean(e.target.value)), inputMode: o.mode || 'decimal', autoComplete: 'off', spellCheck: false, disabled: o.disabled || undefined, placeholder: o.ph, leftElement: o.pre ? affix(o.pre) : undefined, rightElement: o.suf ? affix(o.suf) : undefined, style: o.mono ? mono : undefined }))
    }
    const fx = {
      pfEmp: fld('pf.emp', 'Employee %', { clean: cPct, suf: '%' }),
      pfEr: fld('pf.er', 'Employer %', { clean: cPct, suf: '%' }),
      pfCeiling: fld('pf.ceiling', 'Wage ceiling (₹)', { clean: cNum(8), pre: '₹', money: true, mode: 'numeric', disabled: !f.pf.applyCeiling, hint: f.pf.applyCeiling ? undefined : 'Not used while Apply ceiling is off' }),
      pfCode: fld('pf.code', 'PF establishment code', { clean: cCode, mode: 'text', mono: true }),
      esiEmp: fld('esi.emp', 'Employee %', { clean: cPct, suf: '%' }),
      esiEr: fld('esi.er', 'Employer %', { clean: cPct, suf: '%' }),
      esiCeiling: fld('esi.ceiling', 'Wage ceiling (₹)', { clean: cNum(8), pre: '₹', money: true, mode: 'numeric' }),
      esiCode: fld('esi.code', 'ESI establishment code', { clean: cDigits(17), mode: 'numeric', mono: true }),
      lwfEmp: fld('lwf.emp', 'Employee amount (₹)', { clean: cNum(5), pre: '₹', money: true, mode: 'numeric' }),
      lwfEr: fld('lwf.er', 'Employer amount (₹)', { clean: cNum(5), pre: '₹', money: true, mode: 'numeric' }),
      lwfMonths: canEdit ? createElement(Field as any, { label: 'Deducted in', hint: 'Payroll takes LWF from salaries only in these months’ runs. Check your state’s rule before changing it.' },
        createElement(HrSelect as any, { value: f.lwf.months, onChange: (v: string) => set('lwf', 'months', v), options: [...LWF_SCHEDULES, ...(LWF_SCHEDULES.some(([k]) => k === f.lwf.months) ? [] : [[f.lwf.months, lwfMonthsLabel(f.lwf.months)]])].map(([value, label]) => ({ value, label })) })) : null,
      cStart: fld('cycle.start', 'Cycle start day', { clean: cNum(2), mode: 'numeric', hint: 'Changing it moves the dates that new and re-processed runs pay for. 1 = calendar month.' }),
      cEnd: fld('cycle.end', 'Cycle end day', { clean: cNum(2), mode: 'numeric', disabled: true, hint: 'Always the day before the start day' }),
      cProc: fld('cycle.proc', 'Processing day', { clean: cNum(2), mode: 'numeric', hint: 'Sets the pay date shown on each run' }),
      late: fld('cycle.late', 'Late-mark LOP threshold', { clean: cNum(2), mode: 'numeric', ph: 'Disabled', hint: 'Every N late marks = 1 LOP day. Leave blank to disable.' }),
      ptState: canEdit ? createElement(Field as any, { label: 'State', error: vis('pt.state') }, createElement(HrSelect as any, { value: f.pt.state, onChange: (v: string) => set('pt', 'state', v), options: PT_STATES.map(([, n]) => ({ value: n, label: n })), placeholder: 'Select a state' })) : null,
    }
    const ring = (on: boolean) => (e: any) => { const el = e.currentTarget; el.style.outline = on && el.matches && el.matches(':focus-visible') ? '2px solid #10b981' : 'none'; el.style.outlineOffset = '-4px' }
    const Switch = (on: boolean, onToggle: () => void, aria: any, edge?: boolean, locked?: boolean) => createElement('button', Object.assign({
      type: 'button', role: 'switch', 'aria-checked': on, onClick: locked || !canEdit ? undefined : onToggle, disabled: locked || !canEdit, onFocus: ring(true), onBlur: ring(false),
      style: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 44, margin: edge ? '-10px -6px -10px 0' : '-10px -6px', padding: 0, border: 0, borderRadius: 999, background: 'none', cursor: locked || !canEdit ? 'default' : 'pointer' },
    }, aria),
    createElement('span', { 'aria-hidden': true, style: { position: 'relative', display: 'block', width: 44, height: 24, borderRadius: 999, background: on ? '#0f6e56' : '#cbd5e1', transition: 'background-color .2s' } },
      createElement('span', { style: { position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.28)', transform: on ? 'translateX(20px)' : 'translateX(0px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' } })))
    const V = (label: string, value: string) => ({ label, value })
    const card = (k: keyof Form, title: string, summaryOn: string, extra: any, locked?: boolean) => {
      const on = !!(f[k] as any).on
      return Object.assign({
        on, off: !on, summary: on ? summaryOn : 'Not applied in payroll runs',
        switchNode: createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2 } },
          createElement('span', { 'aria-hidden': true, style: { minWidth: 24, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: on ? '#0f6e56' : '#64748b' } }, on ? 'On' : 'Off'),
          Switch(on, () => set(k, 'on', !on), { 'aria-label': `Apply ${title} in payroll runs`, title: locked ? 'Always on' : undefined }, true, locked)),
      }, extra)
    }
    const slabRows = (p.ptSlabs || []) as { id: string; minSalary: number; maxSalary?: number | null; monthlyTax: number }[]
    // Whether a state levies PT comes from its seeded slabs (Kerala has nine), not a fixed list.
    const ptHas = !!f.pt.state && slabRows.length > 0
    const taxes = slabRows.map((r) => Number(r.monthlyTax))
    const pf = card('pf', 'Provident Fund (PF)', `Employee ${f.pf.emp || '—'}% · Employer ${f.pf.er || '—'}% · ${f.pf.applyCeiling ? 'on wages up to ' + inr(f.pf.ceiling) : 'on full PF wages'}`, {
      ceilSwitch: Switch(!!f.pf.applyCeiling, () => set('pf', 'applyCeiling', !f.pf.applyCeiling), { 'aria-labelledby': 'ps-pf-ceil-l', 'aria-describedby': 'ps-pf-ceil-d' }),
      view: [V('Employee %', f.pf.emp + '%'), V('Employer %', f.pf.er + '%'), V('Wage ceiling', inr(f.pf.ceiling)), V('Apply ceiling', f.pf.applyCeiling ? 'On' : 'Off'), V('PF establishment code', f.pf.code || '—')],
    })
    const esi = card('esi', 'ESI', `Employee ${f.esi.emp || '—'}% · Employer ${f.esi.er || '—'}% · for gross pay up to ${inr(f.esi.ceiling)}`, {
      view: [V('Employee %', f.esi.emp + '%'), V('Employer %', f.esi.er + '%'), V('Wage ceiling', inr(f.esi.ceiling)), V('ESI establishment code', f.esi.code || '—')],
    })
    const pt = card('pt', 'Professional Tax (PT)', !f.pt.state ? 'Choose a state to apply PT' : ptHas ? `${f.pt.state} · ${inr(Math.min(...taxes))} to ${inr(Math.max(...taxes))} a month, by salary` : `${f.pt.state} · no monthly PT slabs`, {
      hasSlabs: ptHas, noState: !f.pt.state, noSlabs: !!f.pt.state && !ptHas, tableTitle: `${f.pt.state} PT slabs`, stateView: f.pt.state || 'Not chosen',
    })
    const lwf = card('lwf', 'Labour Welfare Fund (LWF)', `Employee ${inr(f.lwf.emp)} · Employer ${inr(f.lwf.er)} · deducted in ${lwfMonthsLabel(f.lwf.months)}`, { view: [V('Employee amount', inr(f.lwf.emp)), V('Employer amount', inr(f.lwf.er)), V('Deducted in', lwfMonthsLabel(f.lwf.months))] })
    const cycSum = daysOk ? `${ord(a)} to ${ord(b)} · processed on the ${ord(x)}${c.sandwich ? ' · sandwich rule on' : ''}${c.late ? ` · ${c.late} late marks = 1 LOP day` : ''}` : 'Fix the highlighted days'
    const cycle = card('cycle', 'Payroll Cycle and LOP rules', cycSum, {
      sandSwitch: Switch(!!c.sandwich, () => set('cycle', 'sandwich', !c.sandwich), { 'aria-labelledby': 'ps-sand-l', 'aria-describedby': 'ps-sand-d' }),
      view: [V('Cycle start day', c.start), V('Cycle end day', c.end), V('Processing day', c.proc), V('Sandwich rule', c.sandwich ? 'On' : 'Off'), V('Late-mark LOP threshold', c.late ? `${c.late} late marks = 1 LOP day` : 'Disabled')],
    }, true)
    const endTxt = b >= 29 ? `${ord(b)} (or the month’s last day)` : ord(b)
    const cyc = {
      show: !!c.on && daysOk,
      caption: !inside ? `The ${ord(x)} is outside this cycle — pick a processing day from the ${ord(a)} to the ${ord(b)}.` : a <= b ? `Each cycle covers the ${ord(a)} to the ${endTxt}. Payroll is processed on the ${ord(x)}.` : `Each cycle runs from the ${ord(a)} to the ${ord(b)} of the next month, and a run is named after the month it ends in (the September run covers ${ord(a)} Aug – ${ord(b)} Sep). Payroll is processed on the ${ord(x)}.`,
      days: Array.from({ length: 31 }, (_, i) => { const d = i + 1, inC = a <= b ? d >= a && d <= b : d >= a || d <= b, isP = d === x; return { n: narrow ? '' : String(d), isProc: isP && inside, isBad: isP && !inside, isIn: !isP && inC, isOut: !isP && !inC } }),
    }
    const SECS = [['pf', 'PF', 'Provident Fund (PF)'], ['esi', 'ESI', 'ESI'], ['pt', 'PT', 'Professional Tax (PT)'], ['lwf', 'LWF', 'Labour Welfare Fund (LWF)'], ['cycle', 'Cycle & LOP', 'Payroll Cycle & LOP'], ['tds', 'TDS', 'TDS & tax regime · coming soon']]
    const toc = SECS.map(([k, label, full]) => {
      const on = k === 'tds' ? false : !!(f as any)[k].on, n = secErr[k] || 0, act = s.active === k
      return {
        key: k, label, tip: full, href: '#ps-' + k, active: act, idle: !act, dotOn: k !== 'tds' && on, dotOff: k !== 'tds' && !on, dotSoon: k === 'tds', hasErr: n > 0, errCount: String(n), errAria: `${n} ${n === 1 ? 'error' : 'errors'}`,
        hasMeta: !n && (k === 'tds' || !on), meta: k === 'tds' ? 'Soon' : 'Off', onClick: (e: any) => { if (e && e.preventDefault) e.preventDefault(); this.jump(k) },
      }
    })
    const slabCols = [
      { key: 'range', header: 'Monthly salary', render: (r: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', color: '#0f172a' } }, r.range) },
      { key: 'pt', header: 'PT / month', render: (r: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0f172a' } }, r.pt) },
    ]
    const slabs = slabRows.map((r) => ({ id: r.id, range: r.maxSalary != null ? `${inr(r.minSalary)} – ${inr(r.maxSalary)}` : `${inr(r.minSalary)}+`, pt: inr(r.monthlyTax) }))
    const skb = (w: any, h: number, r?: number) => ({ style: { width: w, height: h, borderRadius: r == null ? 6 : r } })
    const nVis = visKeys.length, t = s.toast, isErrToast = !!(t && t.kind === 'error')
    return {
      rootRef: this.rootRef, live, isLoading, isError, noAccess, canEdit, readOnly,
      showSide: !narrow && (live || isLoading), showChips: narrow && live,
      toc, pf, esi, pt, lwf, cycle, cyc, fx, slabCols, yes: true, slabs,
      sk: { icon: skb(40, 40, 12), sw: skb(44, 24, 999), label: skb(96, 11), input: skb('100%', 40, 10) },
      skCards: [{ title: skb('36%', 14), sub: skb('60%', 11), body: true, fields: [1, 2, 3] }, { title: skb('16%', 14), sub: skb('52%', 11), body: true, fields: [1, 2, 3] }, { title: skb('32%', 14), sub: skb('40%', 11), body: false, fields: [] }, { title: skb('40%', 14), sub: skb('46%', 11), body: false, fields: [] }],
      tocSk: [64, 44, 40, 48, 92, 40].map((w) => skb(w, 12)),
      errIcon: dashIconComponent('alertTriangle'), lockIcon: dashIconComponent('lock'),
      retryAction: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      accessAction: { label: 'Go to Payroll Dashboard', onClick: () => p.onGo && p.onGo('dashboard') },
      barDesk: dirty && !narrow, barMob: dirty && narrow, saving: s.saving,
      changeLabel: `${nChg} ${nChg === 1 ? 'change' : 'changes'} · used by runs processed after saving`,
      hasVisErr: nVis > 0, noVisErr: nVis === 0, errLabel: `Fix ${nVis} ${nVis === 1 ? 'error' : 'errors'} to save`,
      goToError: () => { const k = visKeys[0]; if (k) this.jump(k.split('.')[0], '[aria-invalid="true"]') },
      discard: () => { if (!this.state.saving) this.setState({ form: null, attempted: false }) },
      save: this.save,
      saveIcon: s.saving ? createElement('span', { 'aria-hidden': true, style: { width: 14, height: 14, boxSizing: 'border-box', borderRadius: 999, border: '2px solid rgba(255,255,255,.45)', borderTopColor: '#fff', display: 'inline-block', animation: 'ps-spin .7s linear infinite' } }) : null,
      saveLabel: s.saving ? 'Saving…' : 'Save settings',
      leaveOpen: s.leaveOpen,
      onLeaveOpenChange: (o: boolean) => { if (!o) { this.proceed = null; this.setState({ leaveOpen: false }) } },
      keepEditing: () => { this.proceed = null; this.setState({ leaveOpen: false }) },
      confirmDiscard: () => { const pr = this.proceed; this.proceed = null; this.dirty = false; this.setState({ leaveOpen: false, form: null, attempted: false }, () => { if (pr) pr() }) },
      toastOk: !!t && !isErrToast, toastErr: isErrToast, toastTitle: t ? t.title : '', toastMsg: t ? t.msg : '',
      dismissToast: () => { clearTimeout(this.tt); this.setState({ toast: null }) },
      icPf: dashIcon('banknote', 19), icEsi: dashIcon('shield', 19), icPt: dashIcon('mapPin', 19), icLwf: dashIcon('users', 19), icCycle: dashIcon('calendarDays', 19), icTds: dashIcon('calculator', 19),
      icLock: dashIcon('lock', 16), icLockSm: dashIcon('lock', 13), icMap: dashIcon('mapPin', 18), icInfo: dashIcon('info', 18), icX: dashIcon('x', 15), icOk: dashIcon('checkCircle', 18), icErr: dashIcon('alertTriangle', 18),
    }
  }
  render() { return dc(this, PaySettingsView, 'PaySettings') }
}
