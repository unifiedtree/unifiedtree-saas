// Regularization — ported from the design component AttRegularization.dc.html.
// Team requests: GET /v1/attendance/corrections/approvals; mine: /corrections/my;
// decisions and new requests go through the container's API callbacks.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { AttRegularizationView } from './AttRegularization.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { istToday, addDays } from './dates'

const LBL: Record<string, [string, string]> = { PENDING: ['warn', 'Waiting'], APPROVED: ['ok', 'Approved'], REJECTED: ['red', 'Rejected'] }

export class AttRegularization extends DCLogic {
  state: any = { view: null, newOpen: false, busy: false, f: { date: addDays(istToday(), -1), in: '09:00', out: '18:00', reason: '' } }
  componentDidMount() { if (this.props.openNewKey) this.openFromLogs() }
  componentDidUpdate(pp: any) { if (this.props.openNewKey && this.props.openNewKey !== pp.openNewKey) this.openFromLogs() }
  openFromLogs() { this.setState({ view: 'mine', newOpen: true, f: { ...this.state.f, date: this.props.prefillDate || this.state.f.date } }) }
  renderVals() {
    const p = this.props, st = p.state || 'live', canApprove = p.canApprove ?? true
    const isLoading = st === 'loading', isError = st === 'error', isEmpty = st === 'empty'
    const reqs: any[] = p.requests || [], mine: any[] = p.mine || []
    const live = isEmpty || isLoading || isError ? [] : reqs
    const list = live.filter((r) => r.status === 'PENDING').map((r) => ({ ...r, sub: `${r.emp} · ${r.dept}`, facts: [{ k: 'Day', v: r.date }, { k: 'Came in', v: r.in }, { k: 'Left', v: r.out }] }))
    const decided = live.filter((r) => r.status !== 'PENDING').map((r) => ({ ...r, sub: `${r.emp} · ${r.dept}`, tone: (LBL[r.status] || LBL.PENDING)[0], label: (LBL[r.status] || LBL.PENDING)[1], noteText: r.note || r.reason }))
    const view = canApprove ? this.state.view || 'team' : 'mine'
    const views = [
      { key: 'team', label: 'Team requests', count: isLoading ? '…' : list.length, urgent: list.length > 0, tip: 'Fixes other people asked for' },
      { key: 'mine', label: 'My requests', count: isEmpty ? 0 : mine.length, tip: 'Fixes you asked for' },
    ].filter((v) => canApprove || v.key === 'mine').map((v) => ({ ...v, active: v.key === view, onClick: () => this.setState({ view: v.key }) }))
    const f = this.state.f, t2m = (t: string) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m }
    const valid = !!(f.date && f.in && f.out && t2m(f.out) > t2m(f.in) && f.reason.trim()) && !this.state.busy
    const submit = async () => {
      if (!valid || !p.onNew) return
      this.setState({ busy: true })
      try {
        const ok = await p.onNew({ date: f.date, in: f.in, out: f.out, reason: f.reason.trim() })
        if (ok !== false) this.setState({ newOpen: false, view: 'mine', f: { ...f, reason: '' } })
      } finally { this.setState({ busy: false }) }
    }
    const newFooter = createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      createElement(HrButton, { variant: 'ghost', onClick: () => this.setState({ newOpen: false }) } as any, 'Cancel'),
      createElement(HrButton, { onClick: submit, disabled: !valid } as any, this.state.busy ? 'Sending…' : 'Send request'))
    return {
      canApprove, views, viewTeam: view === 'team', viewMine: view === 'mine', isLoading, isError,
      list, hasList: list.length > 0, caughtUp: !isLoading && !isError && list.length === 0, decided, hasDecided: decided.length > 0,
      decide: (id: string, decision: string, note: string) => p.onDecide && p.onDecide(id, decision, note),
      attach: (r: any) => { if (r.attachmentUrl) window.open(r.attachmentUrl, '_blank', 'noopener') },
      mine: (isEmpty ? [] : mine).map((m) => ({ ...m, tone: (LBL[m.status] || LBL.PENDING)[0], label: (LBL[m.status] || LBL.PENDING)[1] })),
      mineEmpty: isEmpty || mine.length === 0,
      newOpen: this.state.newOpen, openNew: () => this.setState({ newOpen: true }), closeNew: () => this.setState({ newOpen: false }), newFooter,
      f, timeError: f.in && f.out && t2m(f.out) <= t2m(f.in), todayMax: istToday(),
      // Attaching proof needs an upload API the backend doesn't have yet.
      proofOff: true, proofTip: 'Coming soon', proofHelp: 'A gate log, an email or a photo. PDF or image, up to 5 MB. Coming soon.',
      setDate: (e: any) => this.setState({ f: { ...f, date: e.target.value } }),
      setIn: (e: any) => this.setState({ f: { ...f, in: e.target.value } }),
      setOut: (e: any) => this.setState({ f: { ...f, out: e.target.value } }),
      setReason: (e: any) => this.setState({ f: { ...f, reason: e.target.value } }),
      sk: { style: { height: 150, width: '100%', borderRadius: 14 } },
      retry: { label: 'Try again', onClick: () => p.onRetry && p.onRetry() },
      errIcon: dashIconComponent('circleX'), okIcon: dashIconComponent('checkCircle'), icPlus: dashIcon('plus', 15),
    }
  }
  render() { return dc(this, AttRegularizationView, 'AttRegularization') }
}
