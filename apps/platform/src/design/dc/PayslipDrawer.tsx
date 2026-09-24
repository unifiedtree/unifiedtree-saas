// One employee's payslip for a run — ported from the design component
// PayslipDrawer.dc.html. The container passes the payslip already shaped
// (earnings / deductions lines from the API), never a computed estimate.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayslipDrawerView } from './PayslipDrawer.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon } from './icons'

export interface Payslip {
  name: string; code: string; role?: string; dept?: string
  paidDays?: number | null; workingDays?: number | null; lop?: number | null; pan?: string | null; bank?: string | null
  earnings: [string, number][]; deductions: [string, number][]; gross: number; ded: number; net: number
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const two = (x: number) => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? '-' + ONES[x % 10] : ''))
const three = (x: number) => (x >= 100 ? ONES[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '')
/** Indian-system amount in words (crore / lakh / thousand), as on the design's payslip. */
export function inWords(num: number): string {
  const n = Math.floor(num || 0)
  if (!n) return 'zero'
  const out: string[] = [], cr = Math.floor(n / 1e7), la = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, rest = n % 1000
  if (cr) out.push(three(cr) + ' crore')
  if (la) out.push(two(la) + ' lakh')
  if (th) out.push(two(th) + ' thousand')
  if (rest) out.push(three(rest))
  return out.join(' ')
}
export const inr = (n: number | null | undefined, dec = 0) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })

export class PayslipDrawer extends DCLogic<{ slip: Payslip | null; runLabel: string; final: boolean; loading?: boolean; onClose: () => void; onDownload?: () => void; downloading?: boolean }> {
  renderVals() {
    const p = this.props, close = p.onClose, e = p.slip
    const base = { title: 'Payslip', close, footer: null as any, icInfo: dashIcon('info', 16) }
    if (!e) return { ...base, ready: false }
    const money = (n: number) => inr(n, 2), final = !!p.final
    const footer = createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' } },
      createElement(HrButton, { variant: 'ghost', onClick: close } as any, 'Close'),
      p.onDownload ? createElement(HrButton, { onClick: p.onDownload, disabled: p.downloading, 'data-tip': 'Downloads this payslip as a PDF' } as any, dashIcon('download', 15), p.downloading ? ' Downloading…' : ' Download PDF') : null)
    const info = [
      e.paidDays != null ? { k: 'Paid days', v: e.workingDays ? `${e.paidDays} of ${e.workingDays}` : String(e.paidDays) } : null,
      e.lop != null ? { k: 'Loss of pay', v: `${e.lop} ${e.lop === 1 ? 'day' : 'days'}` } : null,
      e.pan ? { k: 'PAN', v: e.pan } : null,
      e.bank ? { k: 'Bank', v: e.bank } : null,
    ].filter(Boolean)
    return {
      ...base, ready: true, footer, name: e.name, code: e.code, month: p.runLabel, role: e.role || '', dept: e.dept || '',
      initials: e.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
      statusTone: final ? 'ok' : 'gray', statusLabel: final ? 'Final' : 'Preview', preview: !final,
      info, earnings: e.earnings.map(([label, v]) => ({ label, amount: money(v) })), deductions: e.deductions.map(([label, v]) => ({ label, amount: money(v) })),
      grossLabel: money(e.gross), dedLabel: money(e.ded), netLabel: money(e.net), netWords: `Rupees ${inWords(e.net)} only`,
    }
  }
  render() { return dc(this, PayslipDrawerView, 'PayslipDrawer') }
}
