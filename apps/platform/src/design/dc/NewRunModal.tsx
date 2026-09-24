// "New payroll run" — pick a company and month. Ported from the design component
// NewRunModal.dc.html. Months that already have a run are shown and disabled;
// the create call is the container's (it resolves true/false).
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { NewRunModalView } from './NewRunModal.view'
import { dashIcon } from './icons'
import { MON, MONTHS, istToday } from './dates'

export interface TakenRun { id: string; company: string; year: number; month: number; label: string; status: string; statusLabel: string }

export class NewRunModal extends DCLogic<{
  open: boolean; companies: { id: string; name: string }[]; runs: TakenRun[]; thisYear?: number
  onClose: () => void; onCreate: (q: { companyId: string; year: number; month: number }) => Promise<boolean> | boolean; onOpenRun: (id: string) => void
}> {
  state: any = { company: null, year: '', month: null, busy: false }
  componentDidUpdate(pp: any) { if (this.props.open && !pp.open) this.setState({ company: null, year: '', month: null, busy: false }) }
  renderVals() {
    const p = this.props, s = this.state, companies = p.companies || [], single = companies.length === 1
    const thisYear = p.thisYear || Number(istToday().slice(0, 4))
    const company: string = s.company !== null ? s.company : single ? companies[0].id : ''
    const year: string = s.year || String(thisYear), y = Number(year), busy = s.busy
    const runs = (p.runs || []).filter((r) => r.company === company), inYear = runs.filter((r) => r.year === y)
    const takenAt = (m: number) => inYear.find((r) => r.month === m && r.status !== 'cancelled')
    const cancelledAt = (m: number) => inYear.find((r) => r.month === m && r.status === 'cancelled')
    const live = runs.filter((r) => r.status !== 'cancelled').map((r) => r.year * 12 + r.month - 1)
    const now = new Date(), nextIdx = live.length ? Math.max(...live) + 1 : now.getFullYear() * 12 + now.getMonth()
    const nextY = Math.floor(nextIdx / 12), nextM = (nextIdx % 12) + 1
    const months = MON.map((label, i) => {
      const m = i + 1, t = takenAt(m), c = cancelledAt(m), sel = s.month === m, isNext = !!company && !t && nextY === y && nextM === m
      const sub = t ? t.statusLabel : sel ? 'Selected' : isNext ? 'Next due' : c ? 'Cancelled' : ''
      return {
        label, sub, subSel: sel, subNext: !sel && isNext, subPlain: !sel && !isNext && !!sub,
        btn: {
          type: 'button', variant: sel ? 'primary' : 'ghost', disabled: busy || !company || !!t, 'aria-pressed': sel,
          'aria-label': `${MONTHS[i]} ${year}${t ? ` — already has a ${String(t.statusLabel).toLowerCase()} run` : ''}`,
          onClick: () => this.setState({ month: m }),
          style: { width: '100%', height: 54, padding: 0, flexDirection: 'column', gap: 2, borderRadius: 12, lineHeight: 1.15, borderColor: isNext && !sel ? '#10b981' : undefined },
        },
      }
    })
    const dup = s.month ? takenAt(s.month) : null, repl = s.month ? cancelledAt(s.month) : null
    const valid = !!company && !!year && !!s.month && !dup
    const last = s.month ? new Date(y, s.month, 0).getDate() : 0, M = s.month ? MON[s.month - 1] : ''
    const phase = !company ? 'company' : !s.month ? 'month' : dup ? 'dup' : 'ok'
    const create = async () => {
      if (!valid || busy) return
      this.setState({ busy: true })
      try { await p.onCreate({ companyId: company, year: y, month: s.month }) } finally { this.setState({ busy: false }) }
    }
    const spin = createElement('span', { key: 's', 'aria-hidden': true, style: { width: 14, height: 14, boxSizing: 'border-box', borderRadius: '50%', border: '2px solid rgba(255,255,255,.45)', borderTopColor: '#fff', display: 'inline-block', animation: 'ut-spin .8s linear infinite' } })
    return {
      isOpen: !!p.open, busy, single, company, year,
      companyOptions: companies.map((c) => ({ value: c.id, label: c.name })),
      // The design lists years from 2020; runs further ahead than next year aren't useful.
      yearOptions: Array.from({ length: Math.max(1, thisYear + 2 - 2020) }, (_, i) => { const v = String(2020 + i); return { value: v, label: v } }),
      setCompany: (v: string) => this.setState({ company: v, month: null }), setYear: (v: string) => this.setState({ year: v, month: null }),
      months,
      hintNeutral: phase === 'company' || phase === 'month', neutralText: phase === 'company' ? 'Choose a company to see which months are open.' : 'Pick the month you want to pay.',
      hintOk: phase === 'ok', okText: s.month ? `${M} ${y} · pays for 1 ${M} – ${last} ${M} ${y}${repl ? ' · replaces the cancelled run' : ''}` : '',
      hintDup: phase === 'dup', dupText: dup ? `${dup.label} already has a run (${dup.statusLabel}).` : '',
      openDup: () => { if (dup) p.onOpenRun(dup.id) },
      cancel: () => { if (!busy) p.onClose() },
      onOpenChange: (v: boolean) => { if (!v && !busy) p.onClose() },
      createBtn: { type: 'button', variant: 'primary', disabled: !valid, 'aria-busy': busy, onClick: create, style: { minWidth: 132 } },
      createInner: busy ? [spin, createElement('span', { key: 't' }, 'Creating…')] : 'Create run',
      icOk: dashIcon('checkCircle', 15), icWarn: dashIcon('alertTriangle', 15), icInfo: dashIcon('info', 15),
    }
  }
  render() { return dc(this, NewRunModalView, 'NewRunModal') }
}
