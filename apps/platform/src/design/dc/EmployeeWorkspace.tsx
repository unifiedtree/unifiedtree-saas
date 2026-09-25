// The employee record page — ported from the design component EmployeeBodyOffline.dc.html
// (docs/Designs/UnifiedTree Employee Workspace (offline).html). The design drew the
// header, the Overview tab, the shift and edit drawers and the lifecycle dialogs; the
// other tabs render their real sections in its frame (EmployeeWorkspaceContainer).
// All data and every action come from the container through `data`; this class keeps
// only what the page itself owns: which dialog/drawer is open, form values, the toast.
import { createElement, type ReactNode } from 'react'
import { HrButton } from '@/shared/components/hr'
import { DCLogic, dc } from './dc-runtime'
import { EmployeeWorkspaceView } from './EmployeeWorkspace.view'

export type WsStatus = 'Active' | 'Probation' | 'Notice period' | 'Suspended' | 'Exited' | 'Terminated'
export interface WsField { key: string; l: string; v: string; type?: string; ph?: string; opts?: { value: string; label: string }[]; off?: boolean; hint?: string; req?: boolean; check?: (v: string) => string }
export interface WorkspaceData {
  state: 'ready' | 'loading' | 'failed' | 'missing'
  onRetry: () => void
  onBack: () => void
  name: string; code: string; seed: number; metaLine: string; status: WsStatus; today: string
  probation: { title: string; sub: string } | null
  tabs: { key: string; label: string; badge?: number }[]; tab: string; onTab: (k: string) => void
  otherContent: ReactNode
  otherPlaceholder: { label: string; note: string; cta: string; onClick: () => void } | null
  jobTitle: string; jobSub: string; facts: { l: string; v: string }[]
  mgr: { name: string; sub: string; seed: number; onOpen: () => void } | null
  account: { active: boolean; activeSub: string; title: string; sub: string; cta: string; primary: boolean; onInvite: () => Promise<string> }
  face: { sub: string; onReset: () => Promise<string> }
  attention: { tone: 'red' | 'amber' | 'orange'; title: string; cta: string; onClick: () => void }[]
  glance: { l: string; v: string; s: string; onClick: () => void }[]
  onboarding: {
    show: boolean; sub: string; note: string
    fields: { l: string; v: string }[]; assets: { id: string; type: string; model: string; serial: string; on: string }[]
    policies: string[]; checklists: { title: string; rows: { l: string; s: string; t: string }[] }[]
  }
  can: { shift: boolean; edit: boolean; lifecycle: boolean; invite: boolean; face: boolean }
  shift: { current: string; upcoming: string; options: { value: string; label: string }[]; effMin: string; onSave: (shiftId: string, from: string) => Promise<string> }
  edit: { basic: WsField[]; financial: WsField[]; onSave: (values: Record<string, string>) => Promise<string>; onFullForm: () => void }
  lifecycle: {
    defaults: { noticeStart: string; lwd: string; reason: string; extendTo: string; exitType: string }
    /** Why the person is leaving (Resignation, Termination, …): recorded on notice and exit, read by the attrition report. */
    exitTypes: { value: string; label: string }[]
    onConfirm: (date: string) => Promise<string>
    onExtend: (date: string) => Promise<string>
    onNotice: (start: string, lwd: string, reason: string, exitType: string) => Promise<string>
    onExit: (lwd: string, reason: string, exitType: string) => Promise<string>
    onCancel: () => Promise<string>
  }
}

const none = async () => ''
/** What the page shows before the record has loaded (loading / failed / not found). */
const EMPTY: Omit<WorkspaceData, 'state' | 'onRetry' | 'onBack' | 'today'> = {
  name: '', code: '', seed: 0, metaLine: '', status: 'Active', probation: null, tabs: [], tab: 'overview', onTab: () => {},
  otherContent: null, otherPlaceholder: null, jobTitle: '', jobSub: '', facts: [], mgr: null,
  account: { active: false, activeSub: '', title: '', sub: '', cta: '', primary: false, onInvite: none }, face: { sub: '', onReset: none },
  attention: [], glance: [], onboarding: { show: false, sub: '', note: '', fields: [], assets: [], policies: [], checklists: [] },
  can: { shift: false, edit: false, lifecycle: false, invite: false, face: false },
  shift: { current: '', upcoming: '', options: [], effMin: '', onSave: none }, edit: { basic: [], financial: [], onSave: none, onFullForm: () => {} },
  lifecycle: { defaults: { noticeStart: '', lwd: '', reason: '', extendTo: '', exitType: '' }, exitTypes: [], onConfirm: none, onExtend: none, onNotice: none, onExit: none, onCancel: none },
}
const TONE: Record<string, string> = { Active: 'ok', Probation: 'warn', 'Notice period': 'orange', Suspended: 'purple', Exited: 'gray', Terminated: 'red' }
const ACTIONS: Record<string, [string, string][]> = {
  Probation: [['confirm', 'Confirm probation'], ['extend', 'Extend probation'], ['notice', 'Start notice']],
  Active: [['notice', 'Start notice']],
  'Notice period': [['cancel', 'Cancel notice'], ['exit', 'Mark exited']],
}
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'

export class EmployeeWorkspace extends DCLogic<{ data: WorkspaceData }> {
  state: any = { modal: null, drawer: null, step: 1, menu: false, resetAsk: false, toast: null, toastErr: false, busy: false, tried: false, form: {}, errs: {}, newShift: '', eff: '', conf: '', ext: '', nStart: '', lwd: '', reason: '', xLwd: '', xReason: '', nType: '', xType: '' }
  private _m: HTMLElement | null = null
  private _md = (e: MouseEvent) => { if (this.state.menu && this._m && !this._m.contains(e.target as Node)) this.setState({ menu: false }) }
  private _t: ReturnType<typeof setTimeout> | undefined
  menuRef = (el: HTMLElement | null) => { this._m = el }
  componentDidMount() { document.addEventListener('mousedown', this._md) }
  componentWillUnmount() { document.removeEventListener('mousedown', this._md); clearTimeout(this._t) }
  say(msg: string, err = false) { clearTimeout(this._t); this.setState({ toast: msg, toastErr: err }); this._t = setTimeout(() => this.setState({ toast: null }), err ? 5000 : 3400) }
  /** Run an action: the toast says what the server did, or why it refused. */
  async run(fn: () => Promise<string>, after?: () => void) {
    if (this.state.busy) return
    this.setState({ busy: true })
    try { const msg = await fn(); after?.(); this.say(msg) } catch (e) { this.say(errText(e), true) } finally { this.setState({ busy: false }) }
  }

  openModal(kind: string) {
    const D = { ...EMPTY, ...this.props.data }, L = D.lifecycle.defaults
    const firstType = D.lifecycle.exitTypes[0]?.value || ''
    this.setState({ menu: false, modal: kind, tried: false, conf: D.today, ext: L.extendTo, nStart: L.noticeStart, lwd: L.lwd, reason: L.reason, xLwd: L.lwd || D.today, xReason: L.reason, nType: L.exitType || firstType, xType: L.exitType || firstType })
  }
  openEdit() {
    const D = { ...EMPTY, ...this.props.data }, form: Record<string, string> = {}
    for (const f of [...D.edit.basic, ...D.edit.financial]) form[f.key] = f.v
    this.setState({ drawer: 'edit', step: 1, menu: false, form, errs: {} })
  }
  fieldErrors(fields: WsField[]) {
    const errs: Record<string, string> = {}
    for (const f of fields) {
      if (f.off) continue
      const v = (this.state.form[f.key] ?? '').trim()
      if (f.req && !v) errs[f.key] = `${f.l.replace(' *', '')} is required`
      else if (v && f.check) { const m = f.check(v); if (m) errs[f.key] = m }
    }
    return errs
  }

  renderVals() {
    const D: WorkspaceData = { ...EMPTY, ...this.props.data }, S = this.state, L = D.lifecycle
    const set = (o: object) => () => this.setState(o)
    const status = D.status, acts = D.can.lifecycle ? ACTIONS[status] || [] : []
    const MD: Record<string, [string, string, string, string]> = {
      confirm: ['Confirm Probation', `${D.name} becomes a permanent employee from the confirmation date.`, 'Confirm probation', 'primary'],
      extend: ['Extend Probation', `Pick the new date ${D.name.split(' ')[0]}’s probation runs until.`, 'Extend probation', 'primary'],
      notice: ['Start Notice Period', 'Record the resignation and the notice period.', 'Start notice', 'primary'],
      exit: ['Mark Employee as Exited', 'Their login is disabled after the last working day. Check the exit type: it decides how this exit is counted in the attrition report.', 'Mark exited', 'danger'],
      cancel: ['Cancel Notice Period', 'The employee becomes active again.', 'Cancel notice', 'primary'],
    }
    const mk: string = S.modal || 'confirm', m = MD[mk]
    const lwdBad = !!S.lwd && S.lwd < S.nStart, lwdMissing = S.tried && !S.lwd
    const extMissing = S.tried && !S.ext, xMissing = S.tried && !S.xLwd
    const F = (l: string, k: string, type?: string, o?: object) => Object.assign({ l, type: type || 'date', v: S[k], on: (e: any) => this.setState({ [k]: e.target.value }), max: undefined, ph: '', hasErr: false, err: '', hasHint: false, hint: '', isInput: true, isSelect: false, opts: [], onSel: () => {} }, o || {})
    // Exit type: a list, recorded with the notice and the exit; the attrition report splits on it.
    const T = (k: string) => F('Exit type *', k, 'text', { isInput: false, isSelect: true, opts: L.exitTypes, onSel: (v: string) => this.setState({ [k]: v }), hasHint: true, hint: 'Shown in the attrition report as resigned, terminated or other.' })
    const mFields = mk === 'confirm' ? [F('Confirmation date', 'conf')]
      : mk === 'extend' ? [F('New probation end date *', 'ext', 'date', { hasErr: extMissing, err: 'New probation end date is required' })]
        : mk === 'notice' ? [T('nType'), F('Notice start date', 'nStart'), F('Last working day *', 'lwd', 'date', { hasErr: !!(lwdBad || lwdMissing), err: lwdBad ? 'Last working day must be on or after the notice start' : 'Last working day is required' }), F('Reason', 'reason', 'text', { max: 100, ph: 'Optional', hasHint: true, hint: (S.reason || '').length + ' / 100' })]
          : mk === 'exit' ? [T('xType'), F('Last working day *', 'xLwd', 'date', { hasErr: xMissing, err: 'Last working day is required' }), F('Exit reason', 'xReason', 'text', { ph: 'Optional', max: 100 })] : []
    const mOk = () => {
      if ((mk === 'notice' && (!S.lwd || lwdBad)) || (mk === 'extend' && !S.ext) || (mk === 'exit' && !S.xLwd)) { this.setState({ tried: true }); return }
      const call = { confirm: () => L.onConfirm(S.conf), extend: () => L.onExtend(S.ext), notice: () => L.onNotice(S.nStart, S.lwd, S.reason, S.nType), exit: () => L.onExit(S.xLwd, S.xReason, S.xType), cancel: () => L.onCancel() }[mk as 'confirm']
      this.run(call, () => this.setState({ modal: null, tried: false }))
    }

    // Shift drawer
    const shiftId: string = S.newShift || D.shift.options[0]?.value || ''
    const eff: string = S.eff || D.today, future = eff > D.today
    const saveShift = () => { if (!shiftId) return; this.run(() => D.shift.onSave(shiftId, eff), () => this.setState({ drawer: null })) }
    const shiftFooter = [
      createElement(HrButton, { key: 1, variant: 'ghost', onClick: set({ drawer: null }) }, 'Cancel'),
      createElement(HrButton, { key: 2, onClick: saveShift, disabled: S.busy || !shiftId }, future ? 'Schedule shift change' : 'Save shift'),
    ]

    // Edit drawer (two steps; each step checks its own fields before moving on)
    const stepFields = S.step === 1 ? D.edit.basic : D.edit.financial
    const next = () => { const errs = this.fieldErrors(D.edit.basic); this.setState({ errs }); if (!Object.keys(errs).length) this.setState({ step: 2 }) }
    const saveEdit = () => {
      const errs = { ...this.fieldErrors(D.edit.basic), ...this.fieldErrors(D.edit.financial) }
      this.setState({ errs })
      if (Object.keys(errs).length) { if (Object.keys(this.fieldErrors(D.edit.basic)).length) this.setState({ step: 1 }); return }
      this.run(() => D.edit.onSave(S.form), () => this.setState({ drawer: null, step: 1 }))
    }
    const editFooter = S.step === 1
      ? [createElement(HrButton, { key: 0, variant: 'ghost', onClick: () => { this.setState({ drawer: null }); D.edit.onFullForm() } }, 'All fields…'),
        createElement(HrButton, { key: 1, variant: 'ghost', onClick: set({ drawer: null }) }, 'Cancel'),
        createElement(HrButton, { key: 2, onClick: next }, 'Next: Financial →')]
      : [createElement(HrButton, { key: 1, variant: 'ghost', onClick: set({ step: 1 }) }, '← Basic'),
        createElement(HrButton, { key: 2, onClick: saveEdit, disabled: S.busy }, 'Save changes')]
    const editFields = stepFields.map((f) => {
      const v = S.form[f.key] ?? '', err = S.errs[f.key] || ''
      const setV = (x: string) => this.setState({ form: { ...S.form, [f.key]: x }, errs: { ...S.errs, [f.key]: '' } })
      return {
        l: f.l, v, type: f.type || 'text', ph: f.ph || '', off: !!f.off, isSelect: !!f.opts && !f.off, isInput: !f.opts || !!f.off,
        opts: f.opts || [], onSel: setV, on: (e: any) => setV(e.target.value), hasErr: !!err, err, hasHint: !err && !!f.hint, hint: f.hint || '',
      }
    })

    const att = D.attention.map((a) => ({ title: a.title, cta: a.cta, on: a.onClick, red: a.tone === 'red', amber: a.tone === 'amber', orange: a.tone === 'orange' }))
    const O = D.onboarding
    return {
      zero: 0, one: 1, four: 4, status, tone: TONE[status] || 'gray', back: D.onBack,
      boxIcon: (p: { size?: number }) => createElement('svg', { width: p.size || 28, height: p.size || 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5' })),
      backAction: { label: 'Back to employees', onClick: D.onBack },
      pLoading: D.state === 'loading', pFailed: D.state === 'failed', pMissing: D.state === 'missing', pReady: D.state === 'ready', retry: D.onRetry,
      name: D.name, code: D.code, seed: D.seed, metaLine: D.metaLine,
      canShift: D.can.shift, canEdit: D.can.edit, canLifecycle: D.can.lifecycle, canInvite: D.can.invite, canFace: D.can.face,
      openShift: () => this.setState({ drawer: 'shift', menu: false, newShift: '', eff: '' }), openEdit: () => this.openEdit(), closeD: set({ drawer: null, step: 1 }),
      hasActs: acts.length > 0, acts: acts.map((a) => ({ label: a[1], on: () => this.openModal(a[0]) })), menu: S.menu, menuRef: this.menuRef, toggleMenu: set({ menu: !S.menu }),
      showBanner: !!D.probation, bTitle: D.probation?.title || '', bSub: D.probation?.sub || '',
      mConfirm: () => this.openModal('confirm'), mExtend: () => this.openModal('extend'), mNotice: () => this.openModal('notice'),
      tabs: D.tabs, tab: D.tab, setTab: (k: string) => { this.setState({ menu: false }); D.onTab(k) },
      isOverview: D.tab === 'overview', isOther: D.tab !== 'overview',
      otherPlaceholder: !!D.otherPlaceholder, otherLabel: D.otherPlaceholder?.label || '', otherNote: D.otherPlaceholder?.note || '',
      otherCta: D.otherPlaceholder?.cta || '', otherAction: D.otherPlaceholder?.onClick || (() => {}), otherContent: D.otherPlaceholder ? null : D.otherContent,
      jobTitle: D.jobTitle, jobSub: D.jobSub, emp: D.facts,
      hasMgr: !!D.mgr, noMgr: !D.mgr, mgrName: D.mgr?.name || '', mgrSub: D.mgr?.sub || '', mgrSeed: D.mgr?.seed || 1, openMgr: () => D.mgr?.onOpen(),
      accActive: D.account.active, accNone: !D.account.active, accActiveSub: D.account.activeSub, accTitle: D.account.title, accSub: D.account.sub,
      accCta: D.account.cta, accVariant: D.account.primary ? 'primary' : 'ghost', invite: () => this.run(D.account.onInvite),
      faceSub: D.face.sub, resetAsk: S.resetAsk, noAsk: !S.resetAsk, askReset: set({ resetAsk: true }), noReset: set({ resetAsk: false }),
      doReset: () => this.run(D.face.onReset, () => this.setState({ resetAsk: false })),
      att, attCount: att.length, noAtt: !att.length, glance: D.glance.map((g) => ({ ...g, on: g.onClick })),
      showOnb: O.show, onbSub: O.sub, onbNote: !!O.note, onbNoteText: O.note, hasOnb: O.fields.length > 0, onb: O.fields,
      hasAssets: O.assets.length > 0, assets: O.assets, hasPolicies: O.policies.length > 0, policies: O.policies, hasChecklists: O.checklists.length > 0, checklists: O.checklists,
      assetCols: [{ key: 'type', header: 'Type' }, { key: 'model', header: 'Model' }, { key: 'serial', header: 'Serial', render: (r: { serial: string }) => createElement('span', { style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 } }, r.serial) }, { key: 'on', header: 'Issued on' }],
      dShift: S.drawer === 'shift', dEdit: S.drawer === 'edit', shiftFooter, editFooter,
      curShift: D.shift.current, hasUpcoming: !!D.shift.upcoming, upcoming: D.shift.upcoming,
      shiftOpts: D.shift.options, newShift: shiftId, setShift: (v: string) => this.setState({ newShift: v }),
      eff, effMin: D.shift.effMin, setEff: (e: any) => this.setState({ eff: e.target.value }),
      effHint: future ? `The change is scheduled for ${new Date(eff + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}; the current shift applies until then.` : 'Applies from today.',
      steps: [{ l: '1 · Basic', on: S.step === 1, off: S.step !== 1 }, { l: '2 · Financial', on: S.step === 2, off: S.step !== 2 }], editFields,
      mOpen: !!S.modal, mChange: (o: boolean) => { if (!o) this.setState({ modal: null }) }, mClose: set({ modal: null }), mTitle: m[0], mDesc: m[1], mCta: m[2], mVariant: m[3], mFields, mOk, mBusy: S.busy,
      hasToast: !!S.toast, toast: S.toast || '', toastOk: !S.toastErr, toastErr: !!S.toastErr,
    }
  }
  render() { return dc(this, EmployeeWorkspaceView, 'EmployeeWorkspace') }
}
