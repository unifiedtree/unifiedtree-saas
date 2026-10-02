// My team's pop-ups, all on the kit: the reason a work-from-home rejection needs, the probation
// Confirm and Extend dialogs, and the Message team panel. Each calls the real API and reports
// what happened.
import { useEffect, useState } from 'react'
import { Dialog, DateInput, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { Callout, errorText } from '@/design/kit/display'
import { istToday } from '@/design/dc/dates'
import { addDays } from '@/shared/components/calendar/dateMath'
import type { TeamProbationRow } from '../api/shared/contracts'
import { useConfirmTeamProbation, useExtendTeamProbation } from '../api/shared/useTeamProbation'
import { TEAM_MESSAGE_MAX_LENGTH, usePostTeamMessage } from '../api/shared/useTeamMessages'
import { dayShort, extendedEnd, firstName } from './teamModel'

/** Work from home can't be rejected without a reason (WFH_REJECT_REASON_REQUIRED). */
export function RejectReasonDialog({ name, open, busy, onClose, onReject }: {
  name: string; open: boolean; busy: boolean; onClose: () => void; onReject: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  useEffect(() => { if (open) { setReason(''); setTried(false) } }, [open])
  const empty = !reason.trim()
  return (
    <Dialog open={open} onClose={onClose} busy={busy} title={`Reject ${firstName(name)}’s work from home?`}
      sub="Say why. They see this reason with the decision." icon="x" tone="danger" initialFocus="first"
      footer={(
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={busy} onClick={() => { setTried(true); if (!empty) onReject(reason.trim()) }}>Reject</PanelButton>
        </>
      )}>
      <Textarea label="Reason" required size="md" rows={3} maxLength={500} value={reason}
        onChange={(e) => setReason(e.target.value)} error={tried && empty ? 'Write a reason to reject.' : undefined} />
    </Dialog>
  )
}

/** Confirm someone's probation (BW-11; hrms.probation.team.decide). */
export function ConfirmProbationDialog({ row, onClose }: { row: TeamProbationRow | null; onClose: () => void }) {
  const toast = useToast()
  const confirm = useConfirmTeamProbation()
  const today = istToday()
  const [date, setDate] = useState(today)
  useEffect(() => { if (row) setDate(today) }, [row, today])
  const save = async () => {
    if (!row) return
    try {
      const r = await confirm.mutateAsync({ employeeId: row.employeeId, confirmationDate: date || today })
      if (!r.available) { toast.error('Confirming probation isn’t switched on for this workspace yet.'); return }
      toast.success(`${row.name} confirmed`, { detail: `${firstName(row.name)} and HR have been told.` })
      onClose()
    } catch (e) {
      toast.error('Couldn’t confirm the probation', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  return (
    <Dialog open={!!row} onClose={onClose} busy={confirm.isPending} title={row ? `Confirm ${row.name}?` : 'Confirm'}
      sub={row ? `Probation ends ${dayShort(row.probationEndDate)}. Confirming ends it as of the date below.` : undefined}
      icon="checkCircle" footer={(
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={confirm.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={confirm.isPending} onClick={save}>Confirm</PanelButton>
        </>
      )}>
      <DateInput label="Confirmation date" size="md" value={date} onChange={(_, v) => setDate(v)} />
    </Dialog>
  )
}

/** Extend someone's probation (BW-11; hrms.probation.team.decide). Defaults to a month after the current end. */
export function ExtendProbationDialog({ row, onClose }: { row: TeamProbationRow | null; onClose: () => void }) {
  const toast = useToast()
  const extend = useExtendTeamProbation()
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  useEffect(() => { if (row) { setDate(extendedEnd(row.probationEndDate)); setNote(''); setTried(false) } }, [row])
  const min = row ? addDays(row.probationEndDate, 1) : undefined
  const bad = !date || (min ? date < min : false)
  const save = async () => {
    setTried(true)
    if (!row || bad) return
    try {
      const r = await extend.mutateAsync({ employeeId: row.employeeId, newEndDate: date, note: note.trim() || null })
      if (!r.available) { toast.error('Extending probation isn’t switched on for this workspace yet.'); return }
      toast.success(`Probation extended to ${dayShort(date)}`, { detail: `${firstName(row.name)} and HR have been told.` })
      onClose()
    } catch (e) {
      toast.error('Couldn’t extend the probation', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  return (
    <Dialog open={!!row} onClose={onClose} busy={extend.isPending} title={row ? `Extend ${row.name}’s probation` : 'Extend probation'}
      sub={row ? `It ends ${dayShort(row.probationEndDate)} now. Pick the new last day.` : undefined}
      icon="calendarClock" footer={(
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={extend.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={extend.isPending} onClick={save}>Extend</PanelButton>
        </>
      )}>
      <div style={{ display: 'grid', gap: 14 }}>
        <DateInput label="New end date" required size="md" value={date} min={min} onChange={(_, v) => setDate(v)}
          error={tried && bad ? 'Pick a day after the current end date.' : undefined} />
        <Textarea label="Note" hint="Optional. HR sees it with the extension." size="md" rows={2} maxLength={500}
          value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  )
}

/** Message team (BW-12; hrms.team.message): one short message to everyone in the team. */
export function MessageTeamPanel({ open, onClose, teamSize, teamLabel }: {
  open: boolean; onClose: () => void; teamSize: number | null; teamLabel: string | null
}) {
  const toast = useToast()
  const post = usePostTeamMessage()
  const [body, setBody] = useState('')
  const [tried, setTried] = useState(false)
  useEffect(() => { if (open) { setBody(''); setTried(false); post.reset() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = body.trim()
  const error = tried && !text ? 'Write a message first.' : text.length > TEAM_MESSAGE_MAX_LENGTH ? `Keep it under ${TEAM_MESSAGE_MAX_LENGTH} characters.` : undefined
  const send = async () => {
    setTried(true)
    if (!text || text.length > TEAM_MESSAGE_MAX_LENGTH) return
    try {
      const r = await post.mutateAsync({ body: text })
      if (!r.available) { toast.error('Team messages aren’t switched on for this workspace yet.'); return }
      const n = r.value.recipientCount ?? 0
      toast.success(`Sent to ${n} ${n === 1 ? 'person' : 'people'}`, { detail: 'They see it in their notifications and on Home.' })
      onClose()
    } catch (e) {
      toast.error('Couldn’t send the message', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  const reach = teamSize == null ? 'Everyone in your team gets it.'
    : teamSize === 0 ? 'No one is in your team yet, so nobody would get it.'
      : `Goes to ${teamSize} ${teamSize === 1 ? 'person' : 'people'}${teamLabel ? ` in ${teamLabel}` : ' in your team'}.`
  return (
    <SidePanel open={open} onClose={onClose} busy={post.isPending} busyLabel="Sending…" title="Message team"
      sub="A short note for everyone in your team: their notifications and their Home show it."
      footer={(
        <>
          <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={post.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" size="lg" busy={post.isPending} onClick={send} blockedReason={teamSize === 0 ? 'No one is in your team yet.' : null}>Send</PanelButton>
        </>
      )}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Callout tone="neutral" icon="users">{reach}</Callout>
        <Textarea label="Message" required rows={6} value={body} maxLength={TEAM_MESSAGE_MAX_LENGTH + 50}
          onChange={(e) => setBody(e.target.value)} error={error}
          hint={`${text.length} of ${TEAM_MESSAGE_MAX_LENGTH} characters`} placeholder="Write a short note for your team" />
      </div>
    </SidePanel>
  )
}
