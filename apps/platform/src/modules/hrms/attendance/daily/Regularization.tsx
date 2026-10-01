// Regularization: fix requests. Approvers (attendance.regularization.approve) see the team's
// requests waiting for them, decide with an optional note, and can take a decision back for ten
// minutes (Undo, BW-06, from GET /v1/approvals/recent-decisions); everyone sees their own requests
// and raises new ones (Fix a day). Who a request went to and who decided it come with each request
// (BW-23).
//   GET  /v1/attendance/corrections/approvals?status=   POST /corrections/{id}/decision
//   GET  /v1/attendance/corrections/my                  POST /corrections
import { useState } from 'react'
import { Button, PageHeader, Section, StatusPill, type StatusTone } from '@/design/kit/display'
import { ApprovalRow, useToast } from '@/design/kit/overlays'
import { FilterPills } from '@/design/kit/display'
import { fmtWd, istToday } from '@/design/dc/dates'
import {
  useCorrectionApprovals, useDecideCorrection, useMyCorrections, type CorrectionRequestResponse,
} from '../../api/useAttendance'
import { correctionProofLink } from '../../api/useAttendanceReview'
import { useRecentDecisions } from '../../api/shared/useRecentDecisions'
import { useDecisionUndo } from '../../api/shared/useDecisionUndo'
import { FixDayPanel } from './FixDayPanel'
import { hhmmIst } from './dailyModel'
import type { DailyPerms } from './DailyTracking'

const STATE: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Waiting', tone: 'amber' }, APPROVED: { label: 'Approved', tone: 'success' }, REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'muted' },
}
const day = (iso: string) => fmtWd(iso.slice(0, 10)).replace(/ \d{4}$/, '')
const asked = (iso: string) => `${day(istToday(new Date(iso)))}, ${hhmmIst(iso)}`

export function Regularization({ perms }: { perms: DailyPerms }) {
  const toast = useToast()
  const approver = perms.approve
  const [view, setView] = useState<'team' | 'mine'>(approver ? 'team' : 'mine')
  const [fixOpen, setFixOpen] = useState(false)
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject' | 'undo'>>({})
  const pending = useCorrectionApprovals('PENDING', { enabled: approver, size: 100 })
  const approved = useCorrectionApprovals('APPROVED', { enabled: approver, size: 5 })
  const rejected = useCorrectionApprovals('REJECTED', { enabled: approver, size: 5 })
  const mine = useMyCorrections()
  const recent = useRecentDecisions({ enabled: approver })
  const decide = useDecideCorrection()
  const undo = useDecisionUndo()
  const undoable = new Map((recent.data ?? []).filter((d) => d.kind === 'CORRECTION').map((d) => [d.requestId, d]))

  const run = (id: string, what: 'approve' | 'reject', note: string) => {
    setBusy((b) => ({ ...b, [id]: what }))
    decide.mutateAsync({ id, status: what === 'approve' ? 'APPROVED' : 'REJECTED', comment: note.trim() || undefined })
      .then(() => toast.success(what === 'approve' ? 'Fix approved — attendance updated' : 'Fix rejected — attendance stays as it was'))
      .catch((e) => { toast.error('Could not record the decision', { detail: (e as Error)?.message }); void pending.refetch() })
      .finally(() => setBusy((b) => { const n = { ...b }; delete n[id]; return n }))
  }
  const takeBack = (id: string) => {
    setBusy((b) => ({ ...b, [id]: 'undo' }))
    undo.mutateAsync({ kind: 'CORRECTION', requestId: id })
      .then((r) => {
        if (!r.available) toast.info('Undo isn’t switched on yet.')
        else toast.success('Decision taken back — the request is waiting again')
      })
      .catch((e) => toast.error('Couldn’t take the decision back', { detail: (e as Error)?.message }))
      .finally(() => setBusy((b) => { const n = { ...b }; delete n[id]; return n }))
  }
  const openProof = (r: CorrectionRequestResponse) => {
    const w = window.open('', '_blank')
    if (w) w.opener = null
    correctionProofLink(r.id).then((l) => { if (w) w.location.href = l.url; else window.open(l.url, '_blank', 'noopener') })
      .catch((e) => { w?.close(); toast.error('Couldn’t open the proof', { detail: (e as Error)?.message }) })
  }
  const facts = (r: CorrectionRequestResponse) => [
    { label: 'Day', value: day(r.requestedDate) },
    { label: 'Came in', value: hhmmIst(r.requestedCheckInAt) },
    { label: 'Left', value: hhmmIst(r.requestedCheckOutAt) },
    { label: 'Asked', value: asked(r.createdAt) },
    ...(r.approverName ? [{ label: 'Goes to', value: r.approverName }] : []),
    ...(r.attachmentUrl ? [{ label: 'Proof', value: <Button size={30} variant="ghost" icon="fileText" onClick={() => openProof(r)}>Open proof</Button> }] : []),
  ]

  const waiting = pending.data?.content ?? []
  const decided = [...(approved.data?.content ?? []), ...(rejected.data?.content ?? [])]
    .sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || ''))
  const myList = mine.data?.content ?? []
  const views = approver && perms.self
    ? <FilterPills label="Whose requests" semantics="tabs" value={view} onChange={(v) => setView(v as 'team' | 'mine')}
      options={[{ value: 'team', label: 'Team requests', count: waiting.length || null }, { value: 'mine', label: 'My requests', count: myList.length || null }]} />
    : null

  return (
    <>
      <PageHeader eyebrow="Attendance & time · Daily tracking" title="Regularization"
        sub={approver && view === 'team' ? 'When someone forgets to punch, they ask for a fix here. Read the reason, then approve or reject it.' : 'Forgot to punch in or out? Ask for a fix here and see what was decided.'}
        actions={perms.self ? <Button variant="primary" icon="plus" onClick={() => setFixOpen(true)}>New request</Button> : undefined} />
      {views}
      {approver && view === 'team' ? (
        <>
          <Section title="Waiting for your OK" count={waiting.length || null} countTone="gold" variant="section" body="list"
            loading={pending.isLoading} error={pending.isError ? pending.error : undefined} onRetry={() => void pending.refetch()} retrying={pending.isFetching}
            empty={waiting.length === 0 ? { title: 'All caught up', hint: 'No attendance fixes are waiting for you.', variant: 'success' } : undefined}>
            <div className="udt-cards">
              {waiting.map((r) => (
                <ApprovalRow key={r.id} variant="card" withNote notePlaceholder="Decision note (optional)"
                  name={r.employeeName || 'Employee'} kind="Fix a day"
                  title={`${day(r.requestedDate)} · ${hhmmIst(r.requestedCheckInAt)}–${hhmmIst(r.requestedCheckOutAt)}`}
                  meta={[r.employeeCode, r.departmentName].filter(Boolean).join(' · ')}
                  reason={r.reason} facts={facts(r)} status="pending" busy={busy[r.id] || false}
                  onApprove={(n) => run(r.id, 'approve', n)} onReject={(n) => run(r.id, 'reject', n)} />
              ))}
            </div>
          </Section>
          {decided.length > 0 && (
            <Section title="Decided lately" variant="section" body="list">
              <div className="udt-cards">
                {decided.map((r) => {
                  const d = undoable.get(r.id)
                  return (
                    <ApprovalRow key={r.id} variant="card" name={r.employeeName || 'Employee'}
                      title={`${day(r.requestedDate)}${r.decidedByName ? ` · by ${r.decidedByName}` : ''}${r.approverComment ? ` · “${r.approverComment}”` : ''}`}
                      status={r.status === 'APPROVED' ? 'approved' : 'rejected'} busy={busy[r.id] || false}
                      onUndo={d ? () => takeBack(r.id) : undefined} canUndo={!!d} undoUntil={d?.undoUntil ?? null} />
                  )
                })}
              </div>
            </Section>
          )}
        </>
      ) : (
        <Section title="My requests" count={myList.length || null} variant="section" body="flush"
          loading={mine.isLoading} error={mine.isError ? mine.error : undefined} onRetry={() => void mine.refetch()}
          empty={myList.length === 0 ? { title: 'No fix requests yet', hint: 'Forgot to punch? Ask for a fix with “New request”.' } : undefined}>
          <ul className="udt-mine">
            {myList.map((r) => {
              const s = STATE[r.status] || STATE.PENDING
              return (
                <li key={r.id} className="udt-mine__row">
                  <span className="udt-two">
                    <span className="udt-num">{day(r.requestedDate)} · {hhmmIst(r.requestedCheckInAt)}–{hhmmIst(r.requestedCheckOutAt)}</span>
                    <span className="udt-q">{r.reason}</span>
                  </span>
                  <span className="udt-two udt-right">
                    <StatusPill tone={s.tone} dot>{s.label}</StatusPill>
                    <span className="udt-q">
                      {r.status === 'PENDING' ? (r.approverName ? `With ${r.approverName}` : 'Waiting for approval')
                        : [r.decidedByName ? `By ${r.decidedByName}` : null, r.approverComment].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      <FixDayPanel open={fixOpen} onClose={() => { setFixOpen(false); setView('mine') }} />
    </>
  )
}
