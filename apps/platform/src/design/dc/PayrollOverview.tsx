// A payroll run's Overview tab — ported from the design component
// PayrollOverview.dc.html. PayrollRunPage passes the real figures in `data`.
import { DCLogic, dc } from './dc-runtime'
import { PayrollOverviewView } from './PayrollOverview.view'
import { dashIcon } from './icons'
import { inr } from './PayslipDrawer'

export interface RunOverviewData {
  /** Per-component totals [label, amount, note?]; null when they couldn't be added up. */
  earnings: [string, number, string?][] | null
  deductions: [string, number, string?][] | null
  gross: number; ded: number; net: number; employees: number; period: string
  checks: { key: string; icon: string; title: string; detail: string; warn: boolean; cta: string; path: string }[]
  details: [string, string][]
  batch: { bank: string; count: number; amount: number; status: 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED' } | null
  onDownloadBatch?: () => void
  log: { what: string; who: string; when: string; kind: 'done' | 'warn' | 'info' }[]
}

export class PayrollOverview extends DCLogic {
  renderVals() {
    const p = this.props, nav = p.onNavigate || (() => {}), D: RunOverviewData | undefined = p.data
    const step: string = p.step || 'draft', busy = !!p.busy, calc = step !== 'draft' && !busy
    if (!D) return { calc: false, busy, notCalc: true, earnings: [], deductions: [], checks: [], details: [], batches: [], log: [], showBank: false }
    const line = ([label, v, note]: [string, number, string?]) => ({ label, amount: inr(v), note: note || '', hasNote: !!note })
    const earnings = D.earnings ? D.earnings.map(line) : [line(['Gross pay', D.gross, 'Component totals aren’t available for this run'])]
    const deductions = D.deductions ? D.deductions.map(line) : [line(['Total deductions', D.ded])]
    const checks = D.checks.map((c) => ({ key: c.key, icon: dashIcon(c.icon, 18), title: c.title, detail: c.detail, ok: !c.warn, warn: c.warn, cta: c.cta, tip: c.cta ? `Opens ${c.cta}` : '', onOpen: () => nav(c.path) }))
    const details = D.details.map(([k, v]) => ({ k, v: v || '', set: !!v, unset: !v }))
    const showBank = step === 'locked' || step === 'paid'
    const b = D.batch, paid = step === 'paid' || b?.status === 'PAID', ready = !!b && (b.status === 'DRAFT' || b.status === 'POSTED')
    const batches = b ? [{ id: 'b', bank: b.bank, count: b.count, amount: inr(b.amount), canDownload: ready, isPaid: paid, tip: 'Downloads the bank upload file', onDownload: () => D.onDownloadBatch && D.onDownloadBatch() }] : []
    const bank = paid ? ['ok', 'Paid', `All ${D.employees} transfers are confirmed by the bank.`] : ready ? ['green', 'File ready', 'Download the file and upload it to your corporate banking portal. Then mark the run as paid.'] : ['gray', 'Not prepared', 'Prepare the bank file to get one NEFT/RTGS upload file for your bank.']
    const DOT: Record<string, string> = { done: '#0f6e56', warn: '#f59e0b', info: '#94a3b8' }
    return {
      calc, busy, notCalc: step === 'draft' && !busy,
      breakdownNote: calc ? `${D.employees} employees · ${D.period}` : busy ? 'Calculating…' : 'Not calculated yet',
      earnings, deductions, grossLabel: inr(D.gross), dedLabel: inr(D.ded), netLabel: inr(D.net), netNote: `Paid to ${D.employees} bank accounts`,
      checksTitle: step === 'draft' ? 'Before you process' : 'Included in this run', checksSub: step === 'draft' ? 'These feed into the calculation. Fix anything flagged first.' : 'Where this month’s figures came from.',
      checks, details, showBank, batches, bankTone: bank[0], bankLabel: bank[1], bankNote: bank[2],
      openBank: () => nav('/hrms/bank-disbursement'),
      log: D.log.map((a) => ({ ...a, meta: [a.who, a.when].filter(Boolean).join(' · '), dot: DOT[a.kind] || DOT.done })),
      skRow: { style: { height: 36, width: '100%', borderRadius: 8 } }, skNet: { style: { height: 56, width: '100%', borderRadius: 14 } },
      icInfo: dashIcon('info', 18), icBank: dashIcon('building', 18), icDownload: dashIcon('download', 14),
    }
  }
  render() { return dc(this, PayrollOverviewView, 'PayrollOverview') }
}
