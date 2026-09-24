// Overtime — ported from the design component ShiftOvertime.dc.html.
// Approval-only by business decision: approved overtime is "Recorded, not paid".
import { DCLogic, dc } from './dc-runtime'
import { ShiftOvertimeView } from './ShiftOvertime.view'
import { dashIcon, dashIconComponent } from './icons'
import { dur } from './shift-util'

const LBL: Record<string, [string, string]> = { APPROVED: ['ok', 'Approved'], REJECTED: ['red', 'Rejected'] }

export class ShiftOvertime extends DCLogic {
  state: any = { view: 'approve' }
  renderVals() {
    const p = this.props, st = p.state || 'live', isLoading = st === 'loading', isError = st === 'error', isEmpty = st === 'empty'
    const items: any[] = isEmpty || isError || isLoading ? [] : p.items || []
    const sum: any[] = isEmpty || isError ? [] : p.summary || []
    const pendRaw = items.filter((o) => o.status === 'PENDING')
    const pending = pendRaw.map((o) => ({
      id: o.id, name: o.name, sub: `${o.emp} · ${o.dept}`, status: 'PENDING', reason: o.reason, raised: o.raised,
      facts: [{ k: 'Day', v: o.date }, { k: 'Shift ended', v: o.shift && o.shift !== '—' ? `${o.shiftEnd} · ${o.shift}` : o.shiftEnd }, { k: 'Left at', v: o.out }, { k: 'Extra time', v: '+' + dur(o.minutes) }],
    }))
    const decided = items.filter((o) => o.status !== 'PENDING').map((o) => ({
      ...o, sub: `${o.emp} · ${o.dept}`, line: `${o.date} · +${dur(o.minutes)}`, noteText: o.note || o.reason, tone: (LBL[o.status] || LBL.APPROVED)[0], label: (LBL[o.status] || LBL.APPROVED)[1],
    }))
    const view = this.state.view, monthLabel = p.monthLabel || ''
    const views = [
      { key: 'approve', label: 'Waiting for you', count: isLoading ? '…' : pending.length, urgent: pending.length > 0, tip: 'Overtime that needs your OK' },
      { key: 'month', label: 'This month', tip: `Everyone’s overtime for ${monthLabel.split(' ')[0]}` },
    ].map((v) => ({ ...v, active: v.key === view, onClick: () => this.setState({ view: v.key }) }))
    const mins = (xs: any[]) => xs.reduce((n, o) => n + (o.minutes || 0), 0)
    const totalMin = mins(sum), pendMin = mins(pendRaw), apprMin = mins(items.filter((o) => o.status === 'APPROVED'))
    const tiles = [
      { icon: dashIcon('timer', 17), color: 'teal', label: 'Extra time this month', value: isLoading ? '—' : dur(totalMin), sub: `Across ${sum.length} people`, tip: `Recorded overtime, ${p.rangeLabel || ''}`, onClick: () => this.setState({ view: 'month' }) },
      { icon: dashIcon('clock', 17), color: 'orange', label: 'Waiting for you', value: isLoading ? '—' : dur(pendMin), sub: `${pendRaw.length} ${pendRaw.length === 1 ? 'entry' : 'entries'} to check`, tip: 'Opens Waiting for you', onClick: () => this.setState({ view: 'approve' }) },
      { icon: dashIcon('checkCircle', 17), color: 'green', label: 'Approved', value: isLoading ? '—' : dur(apprMin), sub: 'Recorded, not paid', tip: 'Approved this month', onClick: () => this.setState({ view: 'month' }) },
    ]
    const max = Math.max(1, ...sum.map((m) => m.minutes))
    const month = sum.slice().sort((a, b) => b.minutes - a.minutes).map((m) => ({ ...m, daysLabel: `${m.days} ${m.days === 1 ? 'day' : 'days'} with overtime`, durLabel: dur(m.minutes), w: ((m.minutes / max) * 100).toFixed(1) + '%' }))
    return {
      views, isError, isLoading, viewApprove: view === 'approve' && !isError, viewMonth: view === 'month' && !isError,
      pending, hasPending: pending.length > 0, caughtUp: !isLoading && pending.length === 0, decided, hasDecided: decided.length > 0,
      tiles, month, noMonth: !isLoading && month.length === 0, monthLabel,
      decide: (id: string, d: string, note: string) => p.onDecide && p.onDecide(id, d, note),
      canDecide: p.canDecide ?? true,
      icInfo: dashIcon('info', 16), okIcon: dashIconComponent('checkCircle'), sk: { style: { height: 150, width: '100%', borderRadius: 14 } }, retry: () => p.onRetry && p.onRetry(),
    }
  }
  render() { return dc(this, ShiftOvertimeView, 'ShiftOvertime') }
}
