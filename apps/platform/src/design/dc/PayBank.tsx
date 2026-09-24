// Bank Disbursement — ported from the design component PayBank.dc.html.
// The API makes one upload file (batch) per run from the company's bank profile:
// build it on the run page, download it here (that posts it), then confirm the
// transfer with the bank's reference — which also marks the run paid.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayBankView } from './PayBank.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'
import type { RunStatus } from './PayRuns'

export interface BankBatch { id: string; reference: string; bank: string; count: number; amount: number; status: 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED' }
export interface BankData {
  run: { id: string; label: string; status: RunStatus; net: number; employees: number } | null
  batch: BankBatch | null
  profile: string | null
  history: BankBatch[]
  people: { name: string; code: string; acct: string; net: number }[] | null
}

export class PayBank extends DCLogic {
  state: any = { confirm: null, view: null, utr: '', busy: false }
  renderVals() {
    const p = this.props, s = this.state, D: BankData | undefined = p.data, go = p.onGo || (() => {})
    const st = p.state || 'live', isLoading = st === 'loading' || (!D && st !== 'error'), isError = st === 'error'
    const run = D?.run || null, isEmpty = !isLoading && !isError && !run, live = !isLoading && !isError && !!run
    const canBuild = !!p.canBuild, canPost = !!p.canPost
    const step = run?.status || 'draft', locked = step === 'locked', paidRun = step === 'paid'
    const openRun = () => (run ? go('runs', { runId: run.id }) : go('runs'))
    const b = D?.batch && D.batch.status !== 'CANCELLED' ? D.batch : null
    const rows = !run ? [] : b
      ? [b].map((x) => {
        const paid = paidRun || x.status === 'PAID', k = paid ? ['ok', 'Paid'] : x.status === 'POSTED' ? ['green', 'Sent to bank'] : ['teal', 'File generated']
        return {
          id: x.reference, bank: x.bank, count: x.count, amountL: inr(x.amount), tone: k[0], statusLabel: k[1],
          canDownload: canBuild, canConfirm: !paid && canPost, needsRun: false, runCta: 'Open run',
          fileTip: 'Downloads the bank upload file', onDownload: () => p.onDownload && p.onDownload(x), onConfirm: () => this.setState({ confirm: x.id, utr: '' }), onView: () => { this.setState({ view: x.id }); if (p.onView) p.onView(x.id) },
        }
      })
      // Before a file exists, the row is the planned one: this run's net pay from the company's bank profile.
      : [{
        id: '—', bank: D?.profile || 'No bank profile yet', count: run.employees, amountL: inr(run.net), tone: 'gray', statusLabel: locked ? 'Not prepared' : 'Waiting for lock',
        canDownload: false, canConfirm: false, needsRun: true, runCta: locked ? 'Prepare file' : 'Open run',
        fileTip: '', onDownload: () => {}, onConfirm: () => {}, onView: openRun,
      }]
    const batches = rows
    const runNote = paidRun ? 'Paid · all transfers confirmed' : b ? 'File ready · upload it to your bank, then confirm the transfer' : locked ? 'Run is locked · prepare the file from the run' : 'The run must be locked before the file can be made'
    const cb = s.confirm && b && b.id === s.confirm ? b : null, vb = s.view && b && b.id === s.view ? b : null
    const columns = [
      { key: 'id', header: 'Batch ID', render: (x: any) => createElement('strong', { style: { fontFamily: "'JetBrains Mono',ui-monospace,monospace", fontSize: 12.5, color: '#0f172a' } }, x.reference) },
      { key: 'bank', header: 'Bank profile', render: (x: any) => x.bank },
      { key: 'amount', header: 'Total amount', render: (x: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, inr(x.amount)) },
      { key: 'count', header: 'Beneficiaries', render: (x: any) => `${x.count} ${x.count === 1 ? 'employee' : 'employees'}` },
      { key: 'status', header: 'Status', render: () => createElement(HrStatusPill, { tone: 'ok' } as any, 'Paid') },
      { key: 'act', header: '', render: (x: any) => (canBuild ? createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: () => p.onDownload && p.onDownload(x), 'data-tip': 'Downloads the file again' } as any, dashIcon('download', 14), ' Download')) : null) },
    ]
    const people = (vb && D?.people) || []
    return {
      isLoading, isError, isEmpty, live, batches, runNote, allDone: false, allDoneText: '', totalLabel: inr(run?.net || 0), openRun, columns, history: D?.history || [],
      runLabel: run?.label || '', runTip: run ? `Opens the ${run.label} payroll run` : 'Opens Processing & Payslips', openProfiles: () => p.onProfiles && p.onProfiles(), icBankSm: dashIcon('building', 15),
      viewOpen: !!vb, vTitle: vb ? vb.reference : '', vSub: vb ? `${vb.bank} · ${vb.count} employees · ${inr(vb.amount)}` : '', closeView: () => this.setState({ view: null }),
      people: people.slice(0, 8).map((e) => ({ ...e, netL: inr(e.net) })), moreLabel: vb ? (vb.count > 8 ? `…and ${vb.count - 8} more in the file.` : '') : '',
      confirmOpen: !!cb, cTitle: cb ? `Confirm transfer for ${cb.bank}?` : 'Confirm transfer?',
      cDesc: cb ? `Only do this after ${cb.bank} shows ${inr(cb.amount)} to ${cb.count} employees as sent. This marks ${run?.label || 'the run'} as paid.` : '',
      utr: s.utr, setUtr: (e: any) => this.setState({ utr: e.target.value }), confirmOff: !s.utr.trim() || s.busy,
      setConfirmOpen: (o: boolean) => { if (!o && !s.busy) this.setState({ confirm: null }) }, closeConfirm: () => { if (!s.busy) this.setState({ confirm: null }) },
      doConfirm: async () => {
        if (!cb || !s.utr.trim() || s.busy || !p.onConfirm) return
        this.setState({ busy: true })
        try { const ok = await p.onConfirm(cb, s.utr.trim()); if (ok !== false) this.setState({ confirm: null, utr: '' }) } finally { this.setState({ busy: false }) }
      },
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('building'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() }, runAction: { label: 'Open Processing & Payslips', onClick: () => go('runs') },
      skA: { style: { height: 160, width: '100%', borderRadius: 16 } }, skB: { style: { height: 200, width: '100%', borderRadius: 16 } },
      icBank: dashIcon('building', 18), icDownload: dashIcon('download', 14), icCheck: dashIcon('check', 14), icOk: dashIcon('checkCircle', 20), icRun: dashIcon('receipt', 15),
    }
  }
  render() { return dc(this, PayBankView, 'PayBank') }
}
