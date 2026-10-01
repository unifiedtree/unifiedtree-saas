// Shifts & overtime · My Shift (people without team access; prototype EmpTime e-shift): the company's shifts with
// their hours and how many people work them (BW-32), a request to move from a date, optionally until a date (BW-31),
// past requests with Withdraw while one waits (BW-34), and the person's overtime requests (DECISIONS 22).
import { useState } from 'react'
import { Button, Callout, Card, EmptyState, Section, SkeletonList, StatusPill, errorText } from '@/design/kit/display'
import { DateInput, FieldGrid, Textarea, useToast } from '@/design/kit/overlays'
import { addDays, fmtShort, istToday } from '@/design/dc/dates'
import type { EmployeeShift, ShiftPolicy } from '../../api/useShiftPolicies'
import { useMyShiftChanges, useRequestShiftChange, useWithdrawShiftChange } from '../../api/shared/useShiftChangeSelf'
import type { ShiftChangeRequest } from '../../api/shared/contracts'
import { changeRange, dayBar, statusOf, timeRange, workDaysLabel } from './shiftModel'
import { MyOvertime } from './MyOvertime'

export function MyShiftView({ shifts, shiftsLoading, mine, today, canSelf, minimumMinutes }: {
  shifts: ShiftPolicy[]
  shiftsLoading: boolean
  mine: EmployeeShift | undefined
  today: string
  canSelf: boolean
  minimumMinutes: number | null
}) {
  const toast = useToast()
  const requests = useMyShiftChanges({ enabled: canSelf })
  const ask = useRequestShiftChange()
  const withdraw = useWithdrawShiftChange()
  const tomorrow = addDays(today, 1)
  const [f, setF] = useState({ to: '', from: tomorrow, until: '', reason: '' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const myId = mine?.shiftPolicyId || null
  const list: ShiftChangeRequest[] = requests.data ?? []
  const waiting = list.some((r) => r.status === 'PENDING')
  const canAsk = canSelf && !!myId && !waiting

  const reason = f.reason.trim()
  const blocked = !f.to ? 'Pick a shift above' : !f.from ? 'Choose the first day'
    : f.until && f.until < f.from ? 'The last day can’t be before the first' : reason.length < 10 ? 'Give a reason of at least 10 characters' : null
  const send = async () => {
    if (blocked) return
    try {
      const res = await ask.mutateAsync({ requestedShiftPolicyId: f.to, effectiveDate: f.from, reason, endDate: f.until || null })
      if (!res.available) {
        toast.info(f.until ? 'A last day isn’t switched on yet. Leave “Until” empty for a permanent change.' : 'Shift change requests aren’t switched on yet.')
        return
      }
      toast.success('Request sent to HR', { detail: 'You’ll be told when it’s decided.' })
      setF({ to: '', from: tomorrow, until: '', reason: '' })
    } catch (e) {
      toast.error('Couldn’t send the request', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  const take = async (r: ShiftChangeRequest) => {
    setBusyId(r.id)
    try {
      const res = await withdraw.mutateAsync(r.id)
      if (res.available) toast.success('Request withdrawn')
      else toast.info('Withdrawing isn’t switched on yet.')
    } catch (e) {
      toast.error('Couldn’t withdraw the request', { detail: errorText(e, 'Try again in a moment.') })
    } finally { setBusyId(null) }
  }

  return (
    <>
      {mine?.upcomingShiftName && mine.upcomingEffectiveFrom && (
        <Callout tone="info" icon="calendarClock">{`Your shift changes to ${mine.upcomingShiftName} on ${fmtShort(mine.upcomingEffectiveFrom)}.`}</Callout>
      )}
      {shiftsLoading ? <SkeletonList rows={2} /> : shifts.length === 0 ? (
        <Card><EmptyState icon="calendarClock" title="No shifts yet" hint="HR adds the company’s shifts. Yours shows here once it’s set." /></Card>
      ) : (
        <div className="apl-shiftcards" role="group" aria-label="Shifts">
          {shifts.map((s) => {
            const isMine = s.id === myId, bar = dayBar(s.startTime, s.endTime)
            const people = typeof s.employeeCount === 'number' ? ` · ${s.employeeCount} ${s.employeeCount === 1 ? 'person' : 'people'}` : ''
            const body = (
              <>
                <span className="apl-shiftcard__top"><span>{s.name}</span>{isMine && <StatusPill tone="mint" size="sm">Your shift</StatusPill>}</span>
                <span className="apl-shiftcard__time">{timeRange(s.startTime, s.endTime)}</span>
                <span className="apl-timebar" aria-hidden="true"><span style={{ left: `${bar.left}%`, width: `${bar.width}%` }} /></span>
                <span className="apl-timebar__axis" aria-hidden="true"><span>00:00</span><span>12:00</span><span>24:00</span></span>
                <span className="apl-shiftcard__meta">{`${workDaysLabel(s.weeklyOffDays)}${people}`}</span>
              </>
            )
            return canAsk && !isMine
              ? <button key={s.id} type="button" className="apl-shiftcard" aria-pressed={f.to === s.id} onClick={() => setF({ ...f, to: s.id })}>{body}</button>
              : <div key={s.id} className={`apl-shiftcard${isMine ? ' apl-shiftcard--mine' : ''}`}>{body}</div>
          })}
        </div>
      )}
      <div className="apl-row">
        <Section title={f.to ? `Move to ${shifts.find((s) => s.id === f.to)?.name ?? 'this shift'}` : 'Pick a different shift above'} className="apl-grow-15">
          {!canSelf ? <p className="apl-note">Shift changes are for people who punch in.</p>
            : !myId ? <p className="apl-note">You don’t have a shift yet. HR sets your first one; then you can ask for a change here.</p>
              : waiting ? <p className="apl-note">You have a request waiting. Withdraw it to ask for something else.</p> : (
                <div className="apl-form">
                  <FieldGrid columns={2}>
                    <DateInput label="From" required min={tomorrow} value={f.from} onChange={(_e, v) => setF({ ...f, from: v, until: f.until && f.until < v ? '' : f.until })} />
                    <DateInput label="Until (optional)" min={f.from || tomorrow} value={f.until || null} clearable onChange={(_e, v) => setF({ ...f, until: v })}
                      hint="Leave empty to stay on the new shift." />
                  </FieldGrid>
                  <Textarea label="Why do you need it?" required rows={3} maxLength={500} placeholder="For example: covering a release window" value={f.reason}
                    onChange={(e) => setF({ ...f, reason: e.target.value })} />
                  <div className="apl-form__actions">
                    <Button onClick={send} loading={ask.isPending} disabled={!!blocked} title={blocked ?? undefined}>Send to HR</Button>
                  </div>
                </div>
              )}
        </Section>
        <Section title="Past changes" className="apl-grow-1" error={requests.error} onRetry={() => requests.refetch()}>
          {requests.isLoading ? <SkeletonList rows={2} /> : list.length === 0 ? (
            <p className="apl-note">No shift change requests yet.</p>
          ) : (
            <ul className="apl-past">
              {list.map((r) => {
                const st = statusOf(r.status)
                const start = r.appliedEffectiveDate || r.requestedEffectiveDate || istToday(new Date(r.createdAt))
                const by = r.approverName && r.decidedAt ? `${r.approverName} · ${fmtShort(istToday(new Date(r.decidedAt)))}` : null
                return (
                  <li key={r.id}>
                    <span className="apl-past__title">{r.reason || `${r.currentShiftName || 'No shift'} → ${r.requestedShiftName || 'another shift'}`}</span>
                    <span className="apl-past__sub">{[`${r.requestedShiftName || 'New shift'} ${changeRange(start, r.requestedEndDate)}`, by, r.decisionNote].filter(Boolean).join(' · ')}</span>
                    <span className="apl-past__side">
                      <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      {r.status === 'PENDING' && (
                        <Button variant="ghost" size={30} loading={busyId === r.id} onClick={() => take(r)}>Withdraw</Button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
      {canSelf && <MyOvertime today={today} minimumMinutes={minimumMinutes} />}
    </>
  )
}
