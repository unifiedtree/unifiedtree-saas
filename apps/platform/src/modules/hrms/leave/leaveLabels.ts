// Small wording and counting rules of the Leave page, kept apart so they can be
// tested without rendering it (audit 5 Oct 2026).
import type { DecidedStatus, LeaveRequestResponse } from '../api/useLeave'

/** A decided status's total; 0 when the server left it out (it only sends the statuses that occur). */
export const decidedCount = (counts: Partial<Record<DecidedStatus, number>> | null | undefined, s: DecidedStatus): number =>
  Number(counts?.[s] ?? 0) || 0

/** Every decided request: approved, rejected and cancelled. */
export const decidedTotal = (counts: Partial<Record<DecidedStatus, number>> | null | undefined): number =>
  decidedCount(counts, 'APPROVED') + decidedCount(counts, 'REJECTED') + decidedCount(counts, 'CANCELLED')

/**
 * Who a request of yours is with, or who decided it, for its line in My leave:
 * "with Meera" while it waits, "approved by Meera" once decided. Empty when
 * nobody is named or it was cancelled. (It used to say "for Meera" whatever the
 * status, which read as if the leave were Meera's.)
 */
export function requestWho(r: Pick<LeaveRequestResponse, 'status' | 'approverName' | 'decidedByName' | 'l2ApproverName'>): string {
  switch (r.status) {
    case 'PENDING': return r.approverName ? `with ${r.approverName}` : ''
    case 'PENDING_L2': return `with ${r.l2ApproverName || 'HR'}`
    case 'APPROVED': { const by = r.decidedByName || r.approverName; return by ? `approved by ${by}` : '' }
    case 'REJECTED': { const by = r.decidedByName || r.approverName; return by ? `rejected by ${by}` : '' }
    default: return ''
  }
}
