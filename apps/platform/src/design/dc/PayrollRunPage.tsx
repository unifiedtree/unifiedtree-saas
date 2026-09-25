// One payroll run (Draft → Processed → Locked → Paid) — ported from the design
// component PayrollRunPage.dc.html. Every step calls the payroll API through the
// container's actions and only moves on when the server says it did.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayrollRunPageView } from './PayrollRunPage.view'
import { dashIcon, dashIconComponent, dashTileIcon } from './icons'
import { inr } from './PayslipDrawer'
import type { RunStatus } from './PayRuns'
import type { RunOverviewData } from './PayrollOverview'
import type { RunEmployeeRow } from './PayrollEmployees'
import type { Payslip } from './PayslipDrawer'

export interface RunView {
  id: string; label: string; company: string; period: string; status: RunStatus; fileTag: string
  employees: number; gross: number; ded: number; net: number; eligible: number | null
  stamps: { created?: string; processed?: string; locked?: string; paid?: string }
}
export interface RunPageData {
  run: RunView
  skipped: { id: string; code: string; name: string; dept: string; joined: string }[]
  fixedIds: string[]
  batch: { id: string; bank: string; count: number; amount: number; status: 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED' } | null
  bankProfile: string | null
  employees: RunEmployeeRow[]
  overview: RunOverviewData
  slip: Payslip | null
  /** Why the open payslip couldn't be loaded, if it couldn't. */
  slipError?: string | null
}
type Act = () => Promise<boolean> | boolean

const STEP: Record<string, string> = { draft: 'draft', processing: 'processed', locked: 'locked', paid: 'paid', cancelled: 'draft' }

export class PayrollRunPage extends DCLogic {
  state: any = { tab: null, modal: null, reason: '', utr: '', slip: null, busy: false, acting: false }
  componentDidMount() { if (this.props.initialTab) this.setState({ tab: this.props.initialTab }) }
  renderVals() {
    const p = this.props, s = this.state, D: RunPageData | undefined = p.data, A = p.actions || {}
    const go = p.onGo || (() => {}), nav = p.onNavigate || null, mobile = !!p.mobile
    const st = p.state || 'live', isLoading = st === 'loading' || (!D && st !== 'error'), isError = st === 'error', ok = !isLoading && !isError
    const run = D?.run, step = run ? STEP[run.status] || 'draft' : 'draft', busy = s.busy
    const cx = run?.status === 'cancelled'
    const batch = D?.batch && D.batch.status !== 'CANCELLED' ? D.batch : null
    const disb = step === 'paid' ? 'paid' : batch ? 'ready' : ''
    const skippedAll = D?.skipped || [], fixed = D?.fixedIds || []
    const nSk = skippedAll.length, unfixed = skippedAll.filter((k) => !fixed.includes(k.id)), fixedWaiting = skippedAll.filter((k) => fixed.includes(k.id))
    const isEmpty = ok && !!run && step === 'draft' && run.eligible === 0 && nSk === 0
    const totals = { employees: run?.employees ?? 0, gross: run?.gross ?? 0, ded: run?.ded ?? 0, net: run?.net ?? 0 }
    const stamps = run?.stamps || {}
    const label = run?.label || ''
    const perm = { manage: !!p.canManage, lock: !!p.canLock, build: !!p.canBuild, post: !!p.canPost }

    const close = () => this.setState({ modal: null, reason: '', utr: '' })
    /**
     * Run an action. Processing closes the dialog at once and shows progress on
     * the page (as designed); the others keep the dialog open until the server agrees.
     */
    const act = async (fn: Act | undefined, processing?: boolean) => {
      if (!fn || s.acting) return
      if (processing) close()
      this.setState({ acting: true, busy: !!processing })
      try { const done = await fn(); if (done !== false && !processing) close() } finally { this.setState({ acting: false, busy: false }) }
    }
    const count = step === 'draft' ? run?.eligible ?? null : totals.employees
    const who = (n: number) => (n === 1 ? '1 employee' : `${n} employees`), was = unfixed.length === 1 ? 'was' : 'were'
    const M: Record<string, any> = {
      process: { title: 'Process payroll?', desc: `Pay for ${count != null ? who(count) : 'everyone with a salary structure'} will be calculated for ${run?.period || ''} from attendance and loan recoveries, and approved PLI awards are added as “Performance incentive”.`, confirm: 'Process payroll', go: () => act(A.process, true), skip: true },
      reprocess: { title: 'Re-process payroll?', desc: 'All payslips will be recalculated with the latest attendance, salary structures, recoveries and approved PLI awards. The current figures will be replaced.', confirm: 'Re-process', go: () => act(A.process, true), skip: true },
      lock: { title: 'Lock this payroll run? Payslips become final.', desc: 'Employees can see their payslips and you can prepare the bank file. PLI awards in this run are marked paid. To change anything after this, you’ll need to reopen the run with a reason.', confirm: 'Lock run', go: () => act(A.lock) },
      reopen: { title: 'Reopen payroll?', desc: 'Payslips go back to draft so you can correct them, and this run’s PLI awards go back to approved (unpaid). You’ll need to lock the run again before paying.', confirm: 'Reopen payroll', go: () => act(() => A.reopen && A.reopen(s.reason.trim())), reopen: true },
      prepare: { title: 'Prepare bank disbursement?', desc: D?.bankProfile ? `We’ll create the NEFT/RTGS upload file for ${D.bankProfile}, one line per employee.` : 'Add a bank profile on Bank Disbursement first — it holds the account salaries are paid from.', confirm: 'Generate bank file', go: () => act(A.prepare), prepare: true },
      paid: { title: `Mark ${label} as paid?`, desc: `Do this after your bank confirms all ${totals.employees} transfers. The run closes and can’t be reopened.`, confirm: 'Mark as paid', go: () => act(() => A.markPaid && A.markPaid(s.utr.trim())), paid: true },
    }
    const m = s.modal ? M[s.modal] : null

    const ORDER: Record<string, number> = { draft: 0, processed: 1, locked: 2, paid: 3 }
    const cur = busy ? 1 : ORDER[step], complete = step === 'paid'
    const steps = [
      { key: 'draft', label: 'Draft', meta: stamps.created ? `Created ${stamps.created.split(',')[0]}` : '' },
      { key: 'processed', label: 'Processed', meta: busy ? 'Processing…' : stamps.processed || 'Not yet' },
      { key: 'locked', label: 'Locked', meta: stamps.locked || 'Not yet' },
      { key: 'paid', label: 'Paid', meta: stamps.paid || (disb === 'ready' ? 'Bank file ready' : 'Not yet') },
    ]
    const LABEL = ['Draft', 'Processed', 'Locked', 'Paid']
    const nextHint = cx ? 'Cancelled before processing. Nothing was paid from this run.' : busy ? `Calculating pay for ${count ?? ''} employees…`
      : step === 'draft' ? `Next: process payroll to calculate pay for ${count != null ? who(count) : 'everyone with a salary structure'}.`
        : step === 'processed' ? 'Next: check the payslips, then lock the run.' : step === 'locked' ? (disb === 'ready' ? 'Next: upload the file to your bank, then mark the run as paid.' : 'Next: prepare the bank file for your banking portal.')
          : 'All done. Payslips are final and salaries are paid.'
    const PILL: Record<string, [string, string]> = { draft: ['gray', 'Draft'], processed: ['blue', 'Processing'], locked: ['teal', 'Locked'], paid: ['green', 'Paid'] }
    const pill = cx ? ['red', 'Cancelled'] : busy ? ['blue', 'Processing'] : PILL[step]
    const nU = unfixed.length, allFixed = nSk > 0 && nU === 0
    const BANNER = allFixed ? ({
      draft: [`${who(nSk)} ready to include`, 'Their salary structures are in. They’ll be included when you process.'],
      processed: [`${who(nSk)} ready to include`, 'Salary structures added. Re-process to add them to this run.'],
      locked: [`${who(nSk)} ready to include`, 'Salary structures added. Reopen and re-process the run to include them.'],
      paid: [`${who(nSk)} ready for next month`, 'Include them in the next run or an off-cycle payment.'],
    } as any)[step] : ({
      draft: [`${who(nU)} will be skipped — no salary structure`, 'They won’t get a payslip this month unless you add a salary structure before you process.'],
      processed: [`${who(nU)} ${was} skipped — no salary structure`, 'Add a salary structure for each of them, then re-process to include them.'],
      locked: [`${who(nU)} ${was} skipped — no salary structure`, 'The run is locked. Add their salary structure and reopen the run, or pay them in the next cycle.'],
      paid: [`${who(nU)} ${was} skipped — no salary structure`, 'They weren’t paid in this run. Include them in next month’s run or an off-cycle payment.'],
    } as any)[step]
    const skippedRows = skippedAll.map((k) => {
      const f = fixed.includes(k.id)
      return { ...k, initials: k.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''), meta: [k.dept, k.joined ? `joined ${k.joined}` : ''].filter(Boolean).join(' · '), isFixed: f, notFixed: !f, tip: 'Opens Salary Structure for ' + k.name, onFix: () => go('salary', { focus: k.id }) }
    })
    const calc = ok && !isEmpty && step !== 'draft' && !busy, zero = isEmpty ? inr(0) : '—', later = 'Calculated when you process'
    const stats = [
      { label: 'Employees', value: isEmpty ? '0' : String(step === 'draft' ? count ?? '—' : totals.employees), sub: isEmpty ? 'No one to pay yet' : nSk ? `${nSk} skipped · no salary structure` : 'Everyone is included', icon: dashTileIcon('users', 22), color: 'teal' },
      { label: 'Gross', value: calc ? inr(totals.gross) : zero, sub: calc ? 'Before deductions' : later, icon: dashTileIcon('rupee', 22), color: 'green' },
      { label: 'Deductions', value: calc ? inr(totals.ded) : zero, sub: calc ? 'PF, ESI, professional tax, recoveries' : later, icon: dashTileIcon('receipt', 22), color: 'teal' },
      { label: 'Net pay', value: calc ? inr(totals.net) : zero, sub: calc ? `To ${totals.employees} bank accounts` : later, icon: dashTileIcon('creditCard', 22), color: 'green' },
    ].map((x) => ({ ...x, loading: isLoading || busy }))
    const tabs = [{ key: 'overview', label: 'Overview' }, calc ? { key: 'employees', label: 'Employees', badge: totals.employees } : { key: 'employees', label: 'Employees' }].concat(nSk ? [{ key: 'skipped', label: 'Skipped', badge: nSk } as any] : [])
    const tab = tabs.some((t) => t.key === s.tab) ? s.tab : 'overview', showContent = ok && !isEmpty
    const spin = createElement('span', { 'aria-hidden': true, style: { width: 14, height: 14, boxSizing: 'border-box', borderRadius: '50%', border: '2px solid rgba(255,255,255,.45)', borderTopColor: '#fff', display: 'inline-block', animation: 'ut-spin .8s linear infinite' } })
    const ask = (k: string) => () => this.setState({ modal: k, reason: '', utr: '' })
    const PATHSEC: Record<string, string> = { '/hrms/bank-disbursement': 'bank', '/hrms/pli': 'pli', '/hrms/advances': 'advances', '/hrms/salary-structure': 'salary' }
    const slipRow = s.slip
    return {
      goRuns: () => go('runs'), goBank: () => go('bank', run ? { runId: run.id } : undefined), downloadRegister: () => A.downloadRegister && A.downloadRegister(),
      navOverview: (path: string) => { const k = PATHSEC[path.split('?')[0]]; if (k) go(k); else if (nav) nav(path) },
      runLabel: label, subtitle: run ? `${run.company} · ${run.period}` : '', pillTone: pill[0], pillLabel: pill[1], meta: run || {}, totals, totalsEmployees: count ?? totals.employees, scale: 1, extraRows: [], limit: 0,
      headReady: ok && !!run, headLoading: isLoading, headError: isError, showActions: ok && !cx, showSteps: ok, stepsLoading: isLoading,
      aDraft: ok && step === 'draft' && !busy && !cx && perm.manage, aBusy: ok && busy,
      aProcessed: ok && step === 'processed' && !busy && (perm.manage || perm.lock), aLocked: ok && step === 'locked' && disb !== 'ready' && (perm.lock || perm.build),
      aReady: ok && step === 'locked' && disb === 'ready' && (perm.lock || perm.post), aPaid: ok && step === 'paid',
      hasFinalLine: ok && (step === 'locked' || step === 'paid'), finalLine: step === 'paid' ? `Paid · ${stamps.paid || ''}` : `Finalized · locked ${stamps.locked || ''}`, finalIcon: dashIcon(step === 'paid' ? 'checkCircle' : 'lock', 15),
      processDisabled: isEmpty, spin, steps, cur, complete, busy, stepOf: cx ? 'Cancelled · no further steps' : complete ? 'All 4 steps done' : `Step ${cur + 1} of 4 · ${busy ? 'Processing' : LABEL[cur]}`, nextHint,
      showBanner: ok && nSk > 0 && !busy, bannerTitle: BANNER ? BANNER[0] : '', bannerBody: BANNER ? BANNER[1] : '', skippedRows, viewSkipped: () => this.setState({ tab: 'skipped' }),
      skippedSub: step === 'draft' ? 'These people get no payslip when you process, until they have a salary structure.' : 'These people got no payslip in this run. Add a salary structure, then re-process.',
      stats, statsDesktop: !isError && !mobile, statsMobile: !isError && mobile,
      showTabs: showContent, tabs, tab, setTab: (k: any) => this.setState({ tab: k && k.target ? k.target.value : k }),
      tOverview: showContent && tab === 'overview', tEmployees: showContent && tab === 'employees', tSkipped: showContent && tab === 'skipped',
      step, disb, nSkipped: nSk, stamps, log: D?.overview.log || [], toast: p.onToast, mobile,
      contentLoading: isLoading, contentError: isError, contentEmpty: ok && isEmpty, emptyTitle: `No one to pay in ${label}`,
      retryAction: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      emptyAction: { label: 'Open Salary Structure', onClick: () => go('salary') }, errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('receipt'),
      slipOpen: !!slipRow, slipEmp: slipRow, slipFinal: step === 'locked' || step === 'paid',
      openSlip: (e: RunEmployeeRow) => { this.setState({ slip: e }); if (A.openSlip) A.openSlip(e.id) },
      closeSlip: () => { this.setState({ slip: null }); if (A.openSlip) A.openSlip(null) },
      askProcess: ask('process'), askReprocess: ask('reprocess'), askLock: ask('lock'), askReopen: ask('reopen'), askPrepare: ask('prepare'), askPaid: ask('paid'),
      mOpen: !!m, mTitle: m ? m.title : '', mDesc: m ? m.desc : '', mConfirmLabel: m ? (s.acting ? 'Working…' : m.confirm) : 'Confirm', mConfirm: () => { if (m) m.go() },
      mDisabled: !!m && (s.acting || (!!m.reopen && s.reason.trim().length < 5) || (!!m.paid && !s.utr.trim()) || (!!m.prepare && !D?.bankProfile)),
      mSkipNote: !!m && !!m.skip && nU > 0, mSkipText: `${who(nU)} without a salary structure will be skipped: ${unfixed.map((k) => k.name).join(', ')}.`,
      mAddNote: !!m && !!m.skip && fixedWaiting.length > 0, mAddText: `${fixedWaiting.map((k) => k.name).join(', ')} now ${fixedWaiting.length === 1 ? 'has a salary structure and' : 'have salary structures and'} will be included.`,
      mIsReopen: !!m && !!m.reopen, mBankNote: !!m && !!m.reopen && disb === 'ready', mBankText: 'The bank file you prepared will be cancelled. Prepare a new one after you lock the run again.',
      mIsPrepare: !!m && !!m.prepare, mIsPaid: !!m && !!m.paid, utr: s.utr, setUtr: (e: any) => this.setState({ utr: e.target.value }),
      batchRows: D?.bankProfile ? [{ bank: D.bankProfile, count: totals.employees, file: 'NEFT/RTGS upload file', amount: inr(totals.net) }] : [], netLabel: inr(totals.net),
      setModalOpen: (o: boolean) => { if (!o && !s.acting) close() }, closeModal: () => { if (!s.acting) close() }, reason: s.reason, setReason: (e: any) => this.setState({ reason: e.target.value }),
      pxOverview: { data: D?.overview }, pxEmployees: { rows: D?.employees || [], canProcess: perm.manage, fileTag: run?.fileTag }, pxSlip: { slip: slipRow ? D?.slip || null : null, error: slipRow ? D?.slipError || null : null, onRetry: A.retrySlip, onDownload: slipRow && A.downloadSlip ? () => A.downloadSlip(slipRow.id) : undefined },
      skTitle: { style: { height: 32, width: 180, borderRadius: 8 } }, skSub: { style: { height: 18, width: 'min(300px,100%)', borderRadius: 6 } }, skSteps: { style: { height: 72, width: '100%', borderRadius: 14 } },
      skBlock: { style: { height: 220, width: '100%', borderRadius: 16 } }, skBlockSm: { style: { height: 140, width: '100%', borderRadius: 16 } },
      icBack: dashIcon('chevronLeft', 16), icPlay: dashIcon('activity', 15), icRedo: dashIcon('swap', 15), icLock: dashIcon('lock', 15), icPencil: dashIcon('pencil', 15), icBank: dashIcon('building', 15),
      icCheck: dashIcon('checkCircle', 15), icCheckSm: dashIcon('checkCircle', 16), icDownload: dashIcon('download', 15), icAlert: dashIcon('alert', 20), icAlertSm: dashIcon('alert', 16),
    }
  }
  render() { return dc(this, PayrollRunPageView, 'PayrollRunPage') }
}
