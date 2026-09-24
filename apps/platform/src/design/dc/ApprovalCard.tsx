// Ported from the design component ApprovalCard.dc.html — shows who raised a
// request and lets an approver decide with an optional note.
import { DCLogic, dc } from './dc-runtime'
import { ApprovalCardView } from './ApprovalCard.view'
import { dashIcon } from './icons'

export class ApprovalCard extends DCLogic {
  state: any = { note: '' }
  renderVals() {
    const p = this.props
    const r = p.request || {}
    const TONE = ({ PENDING: ['warn', 'Pending'], APPROVED: ['ok', 'Approved'], REJECTED: ['red', 'Rejected'] } as Record<string, string[]>)[r.status] || ['gray', r.status]
    const busy = !!p.busy
    return {
      r: { ...r, tone: TONE[0], statusLabel: TONE[1], pending: r.status === 'PENDING', hasAttachment: !!r.attachment, hasNote: !!r.note, onAttachment: () => p.onAttachment && p.onAttachment(r) },
      canDecide: p.canDecide ?? true,
      note: this.state.note,
      setNote: (e: any) => this.setState({ note: e.target.value }),
      approve: () => !busy && p.onDecide && p.onDecide(r.id, 'APPROVED', this.state.note),
      reject: () => !busy && p.onDecide && p.onDecide(r.id, 'REJECTED', this.state.note),
      icFile: dashIcon('fileText', 13),
      approveLabel: p.approveLabel || 'Approve',
      approveTip: p.approveTip || 'Approves and updates attendance',
    }
  }
  render() { return dc(this, ApprovalCardView, 'ApprovalCard') }
}
