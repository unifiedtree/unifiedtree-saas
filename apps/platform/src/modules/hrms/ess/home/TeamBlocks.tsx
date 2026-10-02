// The manager's blocks on Home (EmpHome.dc.html, manager): Punch for a team member,
// Waiting for you (approve / reject in place, with Undo), Today's team and Message team.
// Every list comes from the shared team contracts (C0); nothing here is sample data.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Avatar, Button, EmptyState, ListRow, ListRows, Section, SegmentedControl, StatusPill, errorText, type StatusTone,
} from '@/design/kit/display'
import { ApprovalRow, Dialog, Input, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import type { StaffStatusResponse } from '../../api/useAttendance'
import { useDecideCorrection } from '../../api/useAttendance'
import { useExpenseDecision } from '../../api/useExpense'
import { useLeaveDecision } from '../../api/useLeave'
import { useDecideShiftRequest } from '../../api/useShiftRequests'
import { useWfhDecision } from '../../api/useWfh'
import { useDecisionUndo } from '../../api/shared/useDecisionUndo'
import { usePostTeamMessage } from '../../api/shared/useTeamMessages'
import { useTimesheetDecision } from '../../api/shared/useTimesheetDecision'
import { SHARED_KEYS, type ApprovalsInbox, type DecisionKind, type InboxRow } from '../../api/shared/contracts'
import type { DayBuckets } from '../../attendance/attendanceBuckets'
import { attRows, dayRange, relTime, type AttFilter, type PillTone } from '../../dashboard/dashboardModel'
import { HOME_KEYS, useAssistedPunchEligible, type EligibleEmployee } from './homeApi'
import { money } from './homeModel'
import './home.css'

// ── Punch for a team member ─────────────────────────────────────────────────

/** The strip right under the greeting: the client couldn't find this on the phone-only flow. */
export function TeamPunchEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="uh-punch" role="region" aria-label="Punch for a team member" data-rise="">
      <span className="uh-punch__icon" aria-hidden="true">{dashIcon('userCheck', 19)}</span>
      <span className="uh-punch__text">
        <span className="uh-punch__title">Punch for a team member</span>
        <span className="uh-punch__sub">Check someone in or out with their face when they can’t do it themselves.</span>
      </span>
      <Button variant="primary" size={38} icon="users" onClick={onOpen}>Choose a person</Button>
    </div>
  )
}

const FACE: Record<string, { label: string; tone: StatusTone }> = {
  ENROLLED: { label: 'Face ready', tone: 'success' },
  NOT_ENROLLED: { label: 'No face yet', tone: 'warning' },
  LOCKED: { label: 'Face locked', tone: 'danger' },
  NO_LOGIN: { label: 'No login', tone: 'muted' },
}

function todayLine(e: EligibleEmployee): string {
  const at = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '')
  if (e.checkOutTime) return `Checked out at ${at(e.checkOutTime)}`
  if (e.checkInTime) return `In since ${at(e.checkInTime)}${e.sinceYesterday ? ' yesterday' : ''}`
  return 'Not checked in today'
}

/** Why this person can't be punched from here now, or null (the dialog's own rules, said briefly). */
function cantPunch(e: EligibleEmployee): string | null {
  if (e.faceStatus === 'NOT_ENROLLED') return 'No face enrolled yet: they enrol once, in the app or on the web'
  if (e.faceStatus === 'NO_LOGIN') return 'No app login, so no enrolled face to check'
  if (e.faceStatus === 'LOCKED') return 'Face check locked after failed tries: HR can reset it'
  if (e.todayStatus === 'PUNCHED_OUT') return 'Already punched in and out today'
  return null
}

/**
 * Who the manager may punch for (GET /v1/attendance/assisted-punch/eligible), with their face and
 * today's punch. Picking someone opens P-ATT-DAY's AssistedPunchDialog for them (this computer's
 * camera, the same server checks as the phone).
 */
export function AssistedPunchPanel({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (employeeId: string) => void }) {
  const [q, setQ] = useState('')
  const list = useAssistedPunchEligible(open, q.trim())
  const people = list.data?.employees ?? []
  return (
    <SidePanel open={open} onClose={onClose} title="Punch for a team member" closeLabel="Close panel"
      sub="Pick someone to check them in or out with their face, using this computer’s camera."
      footer={<PanelButton variant="secondary" size="lg" onClick={onClose}>Done</PanelButton>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input type="search" aria-label="Search your team" placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.notAvailable ? (
          <EmptyState icon="userCheck" title="Punching for someone isn’t switched on yet" hint="Ask your admin to turn on assisted punches." />
        ) : list.isLoading ? (
          <EmptyState icon="users" title="Loading your team…" />
        ) : list.error ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 13.5, color: 'var(--u-ink2, #4A5A54)' }}>{errorText(list.error)}</span>
            <Button size={32} onClick={() => list.refetch()}>Try again</Button>
          </div>
        ) : !people.length ? (
          <EmptyState icon="users" title={q ? 'No one matches that search' : 'No one to punch for'} hint={q ? '' : 'People in your team show here.'} />
        ) : (
          <ListRows label="People you can punch for">
            {people.map((e) => {
              const face = FACE[e.faceStatus] ?? { label: e.faceStatus, tone: 'muted' as StatusTone }
              const why = cantPunch(e)
              return (
                <ListRow key={e.employeeId} variant="divided" density="default" chevron={!why}
                  onClick={why ? undefined : () => onPick(e.employeeId)} ariaLabel={why ? undefined : `Punch for ${e.fullName}`}
                  leading={<Avatar name={e.fullName} src={e.profilePhotoUrl} size={34} />}
                  title={e.fullName} sub={[e.jobTitle || e.departmentName, why ?? todayLine(e)].filter(Boolean).join(' · ')}
                  end={<StatusPill tone={face.tone} size="xs">{face.label}</StatusPill>} />
              )
            })}
          </ListRows>
        )}
        {list.data?.truncated && <span style={{ fontSize: 12.5, color: 'var(--u-ink3, #6A7A73)' }}>Showing the first people. Search to find someone else.</span>}
      </div>
    </SidePanel>
  )
}

// ── Waiting for you ─────────────────────────────────────────────────────────

const keyOf = (r: Pick<InboxRow, 'kind' | 'requestId'>) => `${r.kind}:${r.requestId}`
const UNDOABLE = new Set<string>(['LEAVE', 'WFH', 'CORRECTION', 'SHIFT_CHANGE', 'EXPENSE'])

function rowTitle(r: InboxRow): string {
  const parts = [r.title]
  if (r.fromDate) parts.push(dayRange(r.fromDate, r.toDate ?? r.fromDate))
  if (r.days != null && r.days > 0) parts.push(`${r.days} ${r.days === 1 ? 'day' : 'days'}`)
  if (r.amount != null) parts.push(money(r.amount, r.currency))
  return parts.join(' · ')
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

interface Kept { row: InboxRow; status: 'approved' | 'rejected' }

export function WaitingForYou({ inbox, loading, error, onRetry, onSeeAll, limit = 4 }: {
  inbox: ApprovalsInbox | undefined; loading: boolean; error: unknown; onRetry: () => void; onSeeAll: () => void; limit?: number
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const leave = useLeaveDecision()
  const wfh = useWfhDecision()
  const fix = useDecideCorrection()
  const shift = useDecideShiftRequest()
  const expense = useExpenseDecision()
  const timesheet = useTimesheetDecision()
  const undo = useDecisionUndo()
  const [kept, setKept] = useState<Record<string, Kept>>({})
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject' | 'undo'>>({})
  const [rejecting, setRejecting] = useState<InboxRow | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)

  const waiting = (inbox?.rows ?? []).filter((r) => !kept[keyOf(r)])
  const shown: { row: InboxRow; status: 'pending' | 'approved' | 'rejected' }[] = [
    ...Object.values(kept).map((k) => ({ row: k.row, status: k.status })),
    ...waiting.slice(0, limit).map((row) => ({ row, status: 'pending' as const })),
  ]
  const total = inbox ? Math.max(0, inbox.counts.all - Object.values(kept).length) : 0
  const undoOf = useMemo(() => new Map((inbox?.recentDecisions ?? []).map((d) => [`${d.kind}:${d.requestId}`, d.undoUntil])), [inbox?.recentDecisions])

  const refresh = () => Promise.all([SHARED_KEYS.approvalsInbox, SHARED_KEYS.recentDecisions, HOME_KEYS.ess].map((queryKey) => qc.invalidateQueries({ queryKey })))

  async function send(r: InboxRow, approved: boolean, comment?: string) {
    const status = approved ? 'APPROVED' : 'REJECTED'
    switch (r.kind) {
      case 'LEAVE': return leave.mutateAsync({ requestId: r.requestId, status, comment })
      case 'WFH': return wfh.mutateAsync({ requestId: r.requestId, approved, comment })
      case 'CORRECTION': return fix.mutateAsync({ id: r.requestId, status, comment })
      case 'SHIFT_CHANGE': return shift.mutateAsync({ id: r.requestId, approved, comment })
      case 'EXPENSE': return expense.mutateAsync({ id: r.requestId, approved, comment })
      case 'TIMESHEET': {
        const res = await timesheet.mutateAsync({ weekId: r.requestId, status, comment })
        if (!res.available) throw new Error('Timesheet approvals aren’t switched on yet.')
        return res
      }
      default: throw new Error('Open this request to decide it.')
    }
  }

  async function decide(r: InboxRow, approved: boolean, comment?: string) {
    const k = keyOf(r)
    setBusy((b) => ({ ...b, [k]: approved ? 'approve' : 'reject' }))
    try {
      await send(r, approved, comment)
      setKept((m) => ({ ...m, [k]: { row: r, status: approved ? 'approved' : 'rejected' } }))
      toast.success(`${approved ? 'Approved' : 'Rejected'} · ${firstName(r.employeeName)} has been told`)
      setRejecting(null)
      await refresh()
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t save that decision. Try again.'))
    } finally {
      setBusy(({ [k]: _drop, ...rest }) => rest)
    }
  }

  async function takeBack(r: InboxRow) {
    const k = keyOf(r)
    setBusy((b) => ({ ...b, [k]: 'undo' }))
    try {
      const res = await undo.mutateAsync({ kind: r.kind as DecisionKind, requestId: r.requestId })
      if (!res.available) { toast.info('Undo isn’t switched on yet.'); return }
      setKept(({ [k]: _drop, ...rest }) => rest)
      toast.success(`Undone · ${firstName(r.employeeName)}’s request is waiting again`)
      await refresh()
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t undo that decision.'))
    } finally {
      setBusy(({ [k]: _drop, ...rest }) => rest)
    }
  }

  function confirmReject() {
    if (!rejecting) return
    const text = note.trim()
    if (rejecting.rejectNeedsReason && !text) { setNoteError('Say why, so they know what to change.'); return }
    void decide(rejecting, false, text || undefined)
  }

  const line = inbox ? `${total} ${total === 1 ? 'request' : 'requests'} from your team` : undefined
  return (
    <>
      <Section variant="panel" title="Waiting for you" sub={line} body="list" loading={loading} error={error} onRetry={onRetry}
        action={{ label: 'See all', onClick: onSeeAll, ariaLabel: 'See all approvals' }}
        empty={!shown.length ? { title: 'Nothing is waiting for you', hint: 'Requests from your team show here.', icon: 'checkCircle' } : undefined}>
        <div role="list" aria-label="Requests waiting for you">
          {shown.map(({ row: r, status }) => {
            const k = keyOf(r)
            const until = undoOf.get(k) ?? null
            return (
              <div role="listitem" key={k}>
                <ApprovalRow variant="compact" name={r.employeeName} title={rowTitle(r)} meta={relTime(r.createdAt)} status={status}
                  busy={busy[k] ?? false}
                  onApprove={r.canDecide ? () => void decide(r, true) : undefined}
                  onReject={r.canDecide ? () => { setNote(''); setNoteError(null); setRejecting(r) } : undefined}
                  onUndo={status !== 'pending' && UNDOABLE.has(r.kind) && until ? () => void takeBack(r) : undefined}
                  undoUntil={until} />
              </div>
            )
          })}
        </div>
      </Section>
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} busy={!!(rejecting && busy[keyOf(rejecting)])} tone="danger" icon="circleX"
        title="Reject this request?" sub={rejecting ? `${rejecting.employeeName} · ${rowTitle(rejecting)}` : undefined} closeLabel="Close panel"
        footer={<>
          <PanelButton variant="secondary" onClick={() => setRejecting(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={!!(rejecting && busy[keyOf(rejecting)])} onClick={confirmReject}>Reject</PanelButton>
        </>}>
        <Textarea label={rejecting?.rejectNeedsReason ? 'Why' : 'Note (optional)'} required={!!rejecting?.rejectNeedsReason} rows={3} maxLength={500}
          value={note} error={noteError ?? undefined} placeholder="They’ll see this with your decision"
          onChange={(e) => { setNote(e.target.value); setNoteError(null) }} />
      </Dialog>
    </>
  )
}

// ── Today's team ────────────────────────────────────────────────────────────

const PILL: Record<PillTone, StatusTone> = { ok: 'brand', warn: 'warning', bad: 'danger', mint: 'mint', info: 'neutral', gray: 'muted' }

export function TodaysTeam({ staff, counts, loading, error, onRetry, onOpen, limit = 8 }: {
  staff: readonly StaffStatusResponse[]; counts: DayBuckets | null; loading: boolean; error: unknown; onRetry: () => void; onOpen: () => void; limit?: number
}) {
  const [f, setF] = useState<AttFilter>('all')
  const rows = attRows(staff, f, false, limit)
  const sched = counts ? Math.max(0, counts.total - (counts.other || 0)) : 0
  return (
    <Section variant="panel" title="Today’s team" sub={counts ? `${counts.present} of ${sched} working · IST` : undefined} body="list"
      loading={loading} error={error} onRetry={onRetry} footerLink={{ label: 'Open my team', onClick: onOpen }}
      actions={counts ? <SegmentedControl<AttFilter> label="Filter your team" size="lg" value={f} onChange={setF}
        options={[{ value: 'all', label: 'All' }, { value: 'late', label: 'Late', count: counts.late }, { value: 'none', label: 'Not in', count: counts.notMarked }]} /> : undefined}>
      {rows.length ? (
        <div role="list" aria-label="Your team today">
          {rows.map((r) => (
            <div key={r.id} role="listitem" className="uh-team-row">
              <Avatar name={r.name} size={34} />
              <span className="uh-team-row__who">
                <span className="uh-team-row__name">{r.name}</span>
                <span className="uh-team-row__role">{r.dept}</span>
              </span>
              <span className="uh-team-row__at">{r.time}</span>
              <StatusPill tone={PILL[r.tone]} size="sm" minWidth={96}>{r.status}</StatusPill>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="users" minHeight={180}
          title={!staff.length ? 'No one in your team yet' : f === 'late' ? 'No one is late.' : f === 'none' ? 'Everyone has punched in.' : 'No one in your team yet'} />
      )}
    </Section>
  )
}

// ── Message team ────────────────────────────────────────────────────────────

export function MessageTeamDialog({ open, onClose, teamLabel }: { open: boolean; onClose: () => void; teamLabel: string | null }) {
  const toast = useToast()
  const post = usePostTeamMessage()
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const close = () => { if (!post.isPending) { setBody(''); setErr(null); onClose() } }
  async function send() {
    const text = body.trim()
    if (!text) { setErr('Write a message first.'); return }
    try {
      const res = await post.mutateAsync({ body: text })
      if (!res.available) { setErr('Team messages aren’t switched on yet.'); return }
      const n = res.value.recipientCount
      toast.success(n != null ? `Sent to ${n} ${n === 1 ? 'person' : 'people'}` : 'Message sent')
      setBody('')
      onClose()
    } catch (e) {
      setErr(errorText(e, 'Couldn’t send the message. Try again.'))
    }
  }
  return (
    <Dialog open={open} onClose={close} busy={post.isPending} icon="megaphone" closeLabel="Close panel"
      title="Message your team" sub={teamLabel ? `Everyone in ${teamLabel} gets it in the app and on their phone.` : 'Everyone in your team gets it in the app and on their phone.'}
      footer={<>
        <PanelButton variant="secondary" onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" busy={post.isPending} onClick={() => void send()}>Send</PanelButton>
      </>}>
      <Textarea label="Message" required rows={4} maxLength={500} value={body} error={err ?? undefined}
        hint={`${body.trim().length} / 500`} onChange={(e) => { setBody(e.target.value); setErr(null) }} />
    </Dialog>
  )
}
