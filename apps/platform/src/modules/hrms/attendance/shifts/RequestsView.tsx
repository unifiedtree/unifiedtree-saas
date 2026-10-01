// Shifts & overtime · Shift Requests (prototype PgTime a-shifts tab 3, "Change requests"): requests waiting for a
// decision, with the dates they cover (BW-31's "until"), and those decided in the last 30 days. Deciding needs
// attendance.regularization.approve (a manager gets their own team), as before; a decision can be taken back for 10
// minutes (approval Undo, through the shared hook).
import { useState } from 'react'
import { ApprovalRow, useToast } from '@/design/kit/overlays'
import { CellPerson, EmptyState, Section, SkeletonList, StatusPill, Table, errorText, type TableColumn } from '@/design/kit/display'
import { fmtShort, istToday } from '@/design/dc/dates'
import { usePendingShiftRequests, useDecidedShiftRequests, useDecideShiftRequest, type ShiftRequest } from '../../api/useShiftRequests'
import { useRecentDecisions } from '../../api/shared/useRecentDecisions'
import { useDecisionUndo } from '../../api/shared/useDecisionUndo'
import { changeRange, statusOf } from './shiftModel'

const first = (n?: string | null) => (n || 'Employee').split(' ')[0]

export function RequestsView({ canApprove }: { canApprove: boolean }) {
  const toast = useToast()
  const pending = usePendingShiftRequests({ enabled: canApprove })
  const decided = useDecidedShiftRequests(30, { enabled: canApprove })
  const recent = useRecentDecisions({ enabled: canApprove })
  const decide = useDecideShiftRequest()
  const undo = useDecisionUndo()
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject' | 'undo'>>({})
  const mark = (id: string, b?: 'approve' | 'reject' | 'undo') => setBusy((x) => { const n = { ...x }; if (b) n[id] = b; else delete n[id]; return n })

  if (!canApprove) {
    return <EmptyState icon="swap" title="Shift change requests go to approvers" hint="You need the permission to approve attendance requests to see and decide them." />
  }

  const run = async (r: ShiftRequest, approve: boolean, note: string) => {
    mark(r.id, approve ? 'approve' : 'reject')
    try {
      await decide.mutateAsync({ id: r.id, approved: approve, comment: note.trim() || undefined })
      toast.success(approve ? `${r.employeeName || 'Employee'} moves to ${r.requestedShiftName || 'the new shift'}` : 'Shift change rejected', { detail: `${first(r.employeeName)} has been told.` })
    } catch (e) {
      toast.error('Couldn’t record the decision', { detail: errorText(e, 'Try again in a moment.') })
      void pending.refetch()
    } finally { mark(r.id) }
  }
  const takeBack = async (requestId: string, name: string) => {
    mark(requestId, 'undo')
    try {
      const res = await undo.mutateAsync({ kind: 'SHIFT_CHANGE', requestId })
      if (res.available) toast.success(`Undone · ${first(name)} has been told`)
      else toast.info('This decision can’t be taken back here.')
    } catch (e) {
      toast.error('Couldn’t undo the decision', { detail: errorText(e, 'Try again in a moment.') })
    } finally { mark(requestId) }
  }

  const waiting = pending.data ?? []
  const undoable = (recent.data ?? []).filter((d) => d.kind === 'SHIFT_CHANGE')
  const pendingIds = new Set(waiting.map((r) => r.id))
  const done = (decided.data ?? []).filter((r) => !pendingIds.has(r.id))
  const startOf = (r: ShiftRequest) => (r.status === 'PENDING' ? r.requestedEffectiveDate : r.appliedEffectiveDate || r.requestedEffectiveDate)
  const decidedLine = (r: ShiftRequest) => {
    const when = r.decidedAt ? fmtShort(istToday(new Date(r.decidedAt))) : ''
    const head = r.approverName ? `${statusOf(r.status).label} by ${r.approverName}${when ? ', ' + when : ''}` : `Closed automatically${when ? ', ' + when : ''}`
    return r.decisionNote ? `${head} · ${r.decisionNote}` : head
  }
  const columns: TableColumn<ShiftRequest>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.employeeName || 'Employee'} sub={r.employeeCode || undefined} /> },
    { key: 'from', header: 'From', render: (r) => r.currentShiftName || 'No shift yet' },
    { key: 'to', header: 'To', render: (r) => r.requestedShiftName || '—' },
    { key: 'when', header: 'Starting from', render: (r) => changeRange(startOf(r), r.requestedEndDate) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={statusOf(r.status).tone}>{statusOf(r.status).label}</StatusPill> },
    { key: 'note', header: 'Decision', render: (r) => <span className="apl-muted">{decidedLine(r)}</span> },
  ]

  return (
    <>
      <Section title="Shift change requests" count={waiting.length || undefined} countTone="gold" countLabel="waiting" error={pending.error} onRetry={() => pending.refetch()}>
        {pending.isLoading ? <SkeletonList rows={3} /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {undoable.map((d) => (
              <ApprovalRow key={`u-${d.id}`} variant="card" name={d.employeeName} title={d.summary}
                status={d.decision === 'APPROVED' ? 'approved' : 'rejected'} statusLabel={d.decision === 'APPROVED' ? 'Approved' : 'Rejected'}
                busy={busy[d.requestId] === 'undo' ? 'undo' : false} onUndo={() => takeBack(d.requestId, d.employeeName)} undoUntil={d.undoUntil} />
            ))}
            {waiting.map((r) => (
              <ApprovalRow key={r.id} variant="card" name={r.employeeName || 'Employee'} kind="Shift change"
                meta={`Asked ${fmtShort(istToday(new Date(r.createdAt)))}`}
                title={`${r.currentShiftName || 'No shift yet'} → ${r.requestedShiftName || 'another shift'}`}
                reason={r.reason || undefined}
                facts={[
                  { label: 'When', value: changeRange(r.requestedEffectiveDate, r.requestedEndDate) },
                  ...(r.requestedEndDate ? [{ label: 'Then', value: `Back to ${r.currentShiftName || 'no shift'}` }] : []),
                ]}
                status="pending" busy={busy[r.id] ?? false} withNote notePlaceholder={`Note for ${first(r.employeeName)} (optional)`}
                onApprove={(note) => run(r, true, note)} onReject={(note) => run(r, false, note)} />
            ))}
            {!waiting.length && !undoable.length && (
              <EmptyState variant="success" title="All caught up" hint="New shift change requests from your team show up here and in the bell." />
            )}
          </div>
        )}
      </Section>
      <Section title="Already decided" sub="The last 30 days: who decided, when, and their note." body="flush" error={decided.error} onRetry={() => decided.refetch()}>
        <Table label="Shift change requests decided in the last 30 days" columns={columns} rows={done} rowKey={(r) => r.id} loading={decided.isLoading} mobile="cards"
          empty="Nothing decided in the last 30 days." />
      </Section>
    </>
  )
}
