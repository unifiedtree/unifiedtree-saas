// Approve, reject and undo from My team: each kind goes through its own existing decide hook (so
// every guard, validation and refresh stays), Undo through the shared useDecisionUndo, and
// "Approve N with no warnings" through the leave bulk endpoint plus one call per other request.
import { useQueryClient } from '@tanstack/react-query'
import { useLeaveDecision, useBulkLeaveDecision, LEAVE_BULK_MAX } from '../api/useLeave'
import { useWfhDecision } from '../api/useWfh'
import { useDecideCorrection } from '../api/useAttendance'
import { useDecideShiftRequest } from '../api/useShiftRequests'
import { useExpenseDecision } from '../api/useExpense'
import { useTimesheetDecision } from '../api/shared/useTimesheetDecision'
import { useDecisionUndo } from '../api/shared/useDecisionUndo'
import { SHARED_KEYS, type ApprovalKind, type DecisionKind, type InboxRow } from '../api/shared/contracts'
import { errorText } from '@/design/kit/display'

export interface BulkReport {
  approved: number
  failed: { row: InboxRow; message: string }[]
}

export type UndoOutcome = { ok: true; employeeName: string } | { ok: false; notAvailable: true }

export function useTeamDecisions() {
  const qc = useQueryClient()
  const leave = useLeaveDecision()
  const bulk = useBulkLeaveDecision()
  const wfh = useWfhDecision()
  const fix = useDecideCorrection()
  const shift = useDecideShiftRequest()
  const expense = useExpenseDecision()
  const timesheet = useTimesheetDecision()
  const undoer = useDecisionUndo()

  // Team today's "Out soon" and the schedule's waiting cells read the team's time off.
  const refreshTeam = () => Promise.all([SHARED_KEYS.teamTimeOff, SHARED_KEYS.teamSchedule].map((queryKey) => qc.invalidateQueries({ queryKey })))

  /** One decision through the kind's own endpoint. Rejects with the server's message when it is refused. */
  async function decide(kind: ApprovalKind, id: string, approve: boolean, note: string): Promise<void> {
    const comment = note.trim() || undefined
    const status = approve ? 'APPROVED' as const : 'REJECTED' as const
    switch (kind) {
      case 'LEAVE': await leave.mutateAsync({ requestId: id, status, comment }); break
      case 'WFH': await wfh.mutateAsync({ requestId: id, approved: approve, comment }); break
      case 'CORRECTION': await fix.mutateAsync({ id, status, comment }); break
      case 'SHIFT_CHANGE': await shift.mutateAsync({ id, approved: approve, comment }); break
      case 'EXPENSE': await expense.mutateAsync({ id, approved: approve, comment }); break
      case 'TIMESHEET': {
        const r = await timesheet.mutateAsync({ weekId: id, status, comment })
        if (!r.available) throw new Error('Timesheet approvals aren’t switched on for this workspace yet.')
        break
      }
    }
    void refreshTeam()
  }

  /** Approves every row: leave in bulk (one result per request), the rest one by one. */
  async function approveAll(rows: readonly InboxRow[]): Promise<BulkReport> {
    const report: BulkReport = { approved: 0, failed: [] }
    const leaveRows = rows.filter((r) => r.kind === 'LEAVE')
    for (let i = 0; i < leaveRows.length; i += LEAVE_BULK_MAX) {
      const chunk = leaveRows.slice(i, i + LEAVE_BULK_MAX)
      try {
        const out = await bulk.mutateAsync({ ids: chunk.map((r) => r.requestId), status: 'APPROVED' })
        for (const res of out.results) {
          const row = chunk.find((r) => r.requestId === res.id)
          if (!row) continue
          if (res.ok) report.approved++
          else report.failed.push({ row, message: res.message || 'This request couldn’t be approved.' })
        }
      } catch (e) {
        for (const row of chunk) report.failed.push({ row, message: errorText(e, 'These requests couldn’t be approved.') })
      }
    }
    for (const row of rows.filter((r) => r.kind !== 'LEAVE')) {
      try {
        await decide(row.kind, row.requestId, true, '')
        report.approved++
      } catch (e) {
        report.failed.push({ row, message: errorText(e, 'This request couldn’t be approved.') })
      }
    }
    void refreshTeam()
    return report
  }

  /** Takes a decision back. Resolves not-available when the journal has no Undo for it. */
  async function undo(kind: DecisionKind, requestId: string): Promise<UndoOutcome> {
    const r = await undoer.mutateAsync({ kind, requestId })
    if (!r.available) return { ok: false, notAvailable: true }
    void refreshTeam()
    return { ok: true, employeeName: r.value.employeeName }
  }

  return { decide, approveAll, undo }
}
