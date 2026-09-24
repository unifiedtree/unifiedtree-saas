// Shift Requests — ported from the design component ShiftRequests.dc.html.
// HR view: pending change requests (GET /v1/shifts/change-requests/pending) with
// the requester's name, code and department. Employee view ("My Shift"): my
// shift and my requests (GET /v1/shifts/change-requests/my, POST to ask).
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { ShiftRequestsView } from './ShiftRequests.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { tones as T, FALLBACK_TONE as FT, fmt, span, overnight, dur, addMin, dayLabel } from './shift-util'
import { istToday, addDays } from './dates'

const LBL: Record<string, [string, string]> = { PENDING: ['warn', 'Waiting'], APPROVED: ['ok', 'Approved'], REJECTED: ['red', 'Rejected'], EXPIRED: ['gray', 'Expired'], CANCELLED: ['gray', 'Cancelled'] }

export class ShiftRequests extends DCLogic {
  state: any = { notes: {}, ask: false, busy: false, f: { to: '', date: addDays(istToday(), 1), reason: '' } }
  renderVals() {
    const p = this.props, st = p.state || 'live', mine = p.mode === 'mine'
    const isLoading = st === 'loading', isError = st === 'error', isEmpty = st === 'empty'
    const shifts: any[] = p.shifts || [], byId: Record<string, any> = {}
    shifts.forEach((s) => { byId[s.id] = s })
    const sh = (id: string, nameHint?: string) => {
      const s = byId[id]
      if (!s) return { name: nameHint || 'Removed shift', start: '00:00', end: '00:00', iconEl: dashIcon('clock', 18), tint: FT.bg, edge: FT.border, bar: FT.bar, range: '—' }
      const t = T[s.tone] || FT
      return { ...s, iconEl: dashIcon(t.icon, 18, { color: t.fg }), tint: t.bg, edge: t.border, bar: t.bar, range: `${fmt(s.start)} – ${fmt(s.end)}${overnight(s.start, s.end) ? ' (next day)' : ''}` }
    }
    const reqs: any[] = isEmpty || isError || isLoading ? [] : p.requests || []
    const pending = reqs.filter((r) => r.status === 'PENDING').map((r) => {
      const first = String(r.name || '').split(' ')[0], to = sh(r.to, r.toName)
      return {
        ...r, sub: `${r.emp} · ${r.dept}`, from: sh(r.from, r.fromName), to, note: this.state.notes[r.id] || '', notePh: `Note for ${first} (optional)`,
        approveTip: `Moves ${first} to ${to.name} from ${r.starts}`,
        setNote: (e: any) => this.setState({ notes: { ...this.state.notes, [r.id]: e.target.value } }),
        approve: () => p.onDecide && p.onDecide(r.id, 'APPROVED', this.state.notes[r.id]),
        reject: () => p.onDecide && p.onDecide(r.id, 'REJECTED', this.state.notes[r.id]),
      }
    })
    const line = (r: any) => `${sh(r.from, r.fromName).name} → ${sh(r.to, r.toName).name} · from ${r.starts}`
    const decided = reqs.filter((r) => r.status !== 'PENDING').map((r) => ({ ...r, sub: `${r.emp} · ${r.dept}`, line: line(r), noteText: r.note || r.reason, tone: (LBL[r.status] || LBL.PENDING)[0], label: (LBL[r.status] || LBL.PENDING)[1] }))
    const myId = p.myShift, ms = byId[myId] || { name: '', start: '09:00', end: '17:00' }, mt = T[ms.tone] || FT
    const myReqs: any[] = isEmpty ? [] : p.myRequests || [], hasPendingMine = myReqs.some((m) => m.status === 'PENDING')
    const myList = myReqs.map((m) => ({ ...m, line: line(m), noteText: m.note || m.reason, tone: (LBL[m.status] || LBL.PENDING)[0], label: (LBL[m.status] || LBL.PENDING)[1] }))
    const f = this.state.f, close = () => this.setState({ ask: false }), valid = !!(f.to && f.date && f.reason.trim()) && !this.state.busy
    const opts = shifts.filter((s) => s.id !== myId).map((s) => ({ ...sh(s.id), active: f.to === s.id, inactive: f.to !== s.id, onClick: () => this.setState({ f: { ...this.state.f, to: s.id } }) }))
    const submit = async () => {
      if (!valid || !p.onNew) return
      this.setState({ busy: true })
      try {
        const ok = await p.onNew({ to: f.to, date: f.date, reason: f.reason.trim() })
        if (ok !== false) this.setState({ ask: false, f: { to: '', date: addDays(istToday(), 1), reason: '' } })
      } finally { this.setState({ busy: false }) }
    }
    const footer = createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      createElement(HrButton, { variant: 'ghost', onClick: close } as any, 'Cancel'),
      createElement(HrButton, { onClick: submit, disabled: !valid } as any, this.state.busy ? 'Sending…' : 'Send request'))
    return {
      isError, isLoading, showHr: !mine && !isError && !isLoading, showMine: mine && !isError && !isLoading, isDesktop: !p.mobile,
      pending, caughtUp: pending.length === 0, decided, hasDecided: decided.length > 0,
      my: {
        name: ms.name || 'No shift yet', start: ms.start, end: ms.end, tint: mt.bg, edge: mt.border, bar: mt.bar, iconBig: dashIcon(mt.icon, 26, { color: mt.fg }),
        startLabel: fmt(ms.start), endLabel: fmt(ms.end) + (overnight(ms.start, ms.end) ? ' (next day)' : ''),
        hoursLabel: `${dur(span(ms.start, ms.end))} a day`, lateLabel: ms.grace ? `Late after ${fmt(addMin(ms.start, ms.grace))}` : 'Late right at the start',
        breakLabel: ms.breakMin ? (ms.breakMin === 60 ? '1 hour break' : `${ms.breakMin} min break`) : 'No break',
        sinceLabel: p.mySince ? `Since ${p.mySince}` : '',
      },
      canAsk: !hasPendingMine && !!myId, hasPendingMine, myList, myEmpty: myList.length === 0,
      openAsk: () => this.setState({ ask: true }), askOpen: this.state.ask, close, footer, opts, f,
      tomorrowMin: addDays(istToday(), 1),
      setDate: (e: any) => this.setState({ f: { ...f, date: e.target.value } }), setReason: (e: any) => this.setState({ f: { ...f, reason: e.target.value } }),
      icArrow: dashIcon('arrowRight', 18), icCheck: dashIcon('check', 15), icCheckSm: dashIcon('check', 13), icSwap: dashIcon('swap', 15), icClock: dashIcon('clock', 14),
      icTimer: dashIcon('timer', 14), icCoffee: dashIcon('coffee', 14), icCal: dashIcon('calendar', 14), okIcon: dashIconComponent('checkCircle'),
      sk: { style: { height: 260, width: '100%', borderRadius: 18 } }, retry: () => p.onRetry && p.onRetry(),
      dayLabel,
    }
  }
  render() { return dc(this, ShiftRequestsView, 'ShiftRequests') }
}
