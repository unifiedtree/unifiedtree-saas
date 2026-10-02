// "Request overtime" (DECISIONS 22): anyone who punches in (attendance.checkin.self) can ask for overtime on a day they
// choose, from 60 days back to 30 days ahead, with the minutes and a reason. Their approver approves or rejects it;
// they can withdraw it while it waits. Overtime is recorded, never paid. While the server can't take requests yet the
// section says so and offers nothing (FEATURE_NOT_READY / 404).
import { useState } from 'react'
import { Button, EmptyState, Section, SkeletonList, StatusPill, errorText } from '@/design/kit/display'
import { DateInput, FieldGrid, Input, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { addDays, fmtShort } from '@/design/dc/dates'
import { useMyOvertimeRequests, useRequestOvertime, useWithdrawOvertimeRequest, type OvertimeRequest } from '../../api/useOvertime'
import { hm, statusOf, toMinutes } from './shiftModel'

export function MyOvertime({ today, minimumMinutes }: { today: string; minimumMinutes: number | null }) {
  const toast = useToast()
  const mine = useMyOvertimeRequests()
  const withdraw = useWithdrawOvertimeRequest()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (mine.notAvailable) return null

  const take = async (r: OvertimeRequest) => {
    setBusyId(r.id)
    try {
      const res = await withdraw.mutateAsync(r.id)
      if (res.available) toast.success('Overtime request withdrawn')
      else toast.info('Withdrawing isn’t switched on yet.')
    } catch (e) {
      toast.error('Couldn’t withdraw the request', { detail: errorText(e, 'Try again in a moment.') })
    } finally { setBusyId(null) }
  }
  const rows = mine.data ?? []
  return (
    <>
      <Section title="Your overtime requests" sub={`Ask for overtime on any day. ${minimumMinutes ? `It counts from ${hm(minimumMinutes)}; then all of it counts. ` : ''}Approved overtime is recorded, not paid.`}
        actions={<Button icon="plus" onClick={() => setOpen(true)}>Request overtime</Button>}
        error={mine.error} onRetry={() => mine.refetch()}>
        {mine.isLoading ? <SkeletonList rows={2} /> : rows.length === 0 ? (
          <EmptyState variant="dashed" title="No overtime requests yet" hint="Stayed late or working extra on a day? Ask for it here." />
        ) : (
          <ul className="apl-past">
            {rows.map((r) => {
              const st = statusOf(r.status)
              return (
                <li key={r.id}>
                  <span className="apl-past__title">{`${hm(r.minutes)} on ${fmtShort(r.date)}`}</span>
                  <span className="apl-past__sub">{[r.reason, r.decidedByName ? `${st.label} by ${r.decidedByName}` : null, r.decisionNote].filter(Boolean).join(' · ')}</span>
                  <span className="apl-past__side">
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    {r.status === 'PENDING' && (
                      <Button variant="ghost" size={30} loading={busyId === r.id} onClick={() => take(r)} aria-label={`Withdraw the request for ${fmtShort(r.date)}`}>Withdraw</Button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
      <RequestOvertimePanel open={open} onClose={() => setOpen(false)} today={today} minimumMinutes={minimumMinutes} />
    </>
  )
}

export function RequestOvertimePanel({ open, onClose, today, minimumMinutes }: { open: boolean; onClose: () => void; today: string; minimumMinutes: number | null }) {
  const toast = useToast()
  const ask = useRequestOvertime()
  const [f, setF] = useState({ date: today, hours: '1', minutes: '', reason: '' })
  const minutes = toMinutes(f.hours, f.minutes)
  const reason = f.reason.trim()
  const blocked = !f.date ? 'Choose the day'
    : minutes == null || minutes <= 0 ? 'Enter the extra time'
      : minutes > 1440 ? 'Up to 24 hours'
        : minimumMinutes != null && minutes < minimumMinutes ? `Overtime starts at ${hm(minimumMinutes)}`
          : reason.length < 10 ? 'Give a reason of at least 10 characters' : null
  const send = async () => {
    if (blocked || minutes == null) return
    try {
      const res = await ask.mutateAsync({ date: f.date, minutes, reason })
      if (!res.available) { toast.info('Overtime requests aren’t switched on yet.'); return }
      toast.success('Overtime request sent', { detail: 'Your approver has been told.' })
      setF({ date: today, hours: '1', minutes: '', reason: '' })
      onClose()
    } catch (e) {
      toast.error('Couldn’t send the request', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  return (
    <SidePanel open={open} onClose={onClose} busy={ask.isPending} title="Request overtime"
      sub="Your approver approves or rejects it. Approved overtime is recorded, not paid."
      footer={(
        <>
          <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={ask.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" size="lg" busy={ask.isPending} blockedReason={blocked} onClick={send}>Send request</PanelButton>
        </>
      )}>
      <div className="apl-form">
        <DateInput label="Day" required min={addDays(today, -60)} max={addDays(today, 30)} value={f.date} onChange={(_e, v) => setF({ ...f, date: v })}
          hint="Up to 60 days back or 30 days ahead." />
        <FieldGrid columns={2}>
          <Input label="Hours" type="number" min={0} max={24} inputMode="numeric" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          <Input label="Minutes" type="number" min={0} max={59} inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
        </FieldGrid>
        <p className="apl-note">
          {minimumMinutes == null
            ? 'Overtime has a minimum (1 hour unless your company changed it). Under it, extra time isn’t overtime; from it, all of the time counts.'
            : minimumMinutes > 0
              ? `Overtime counts from ${hm(minimumMinutes)}. Under that it isn’t overtime; from it, all of the time counts.`
              : 'Every extra minute counts.'}
        </p>
        <Textarea label="Reason" required rows={3} maxLength={500} placeholder="For example: month-end closing" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
    </SidePanel>
  )
}
