import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { Button, Callout, ListRow, ListRows, PageFrame, PageHeader, Section, StatusPill, type StatusTone } from '@/design/kit/display'
import { DateInput, Dialog, PanelButton, Textarea, useToast } from '@/design/kit/overlays'
import { errorText } from '@/design/kit/EmptyState'
import { addDays, fmtShort, istToday } from '@/design/dc/dates'
import { useApprovers } from '../api/shared/useApprovers'
import { useMyShiftChanges, useRequestShiftChange, useWithdrawShiftChange } from '../api/shared/useShiftChangeSelf'
import type { ShiftChangeRequest as ChangeRequest } from '../api/shared/contracts'
import { sentWhen } from '../ess/home/homeModel'
import { barSegments, changeDates, peopleWord, shiftProblem, timeRange, workDays } from './shiftModel'
import '../wfh/wfh.css'

/**
 * Employee-facing shift-change request (/me/shift-change), redesign P-HOME (EmpTime.dc.html, e-shift).
 * Web mirror of Attendance_App/app/shift-change.tsx.
 *
 * Backend endpoints (com.hrms.api.attendance.ShiftController):
 *   GET  /v1/shifts?companyId=…                       → ShiftPolicyResponse[] (with employeeCount, BW-32)
 *   GET  /v1/shifts/employee/{employeeId}             → EmployeeShiftResponse (current)
 *   POST /v1/shifts/change-requests                   → { requestedShiftPolicyId, effectiveDate, reason, endDate? }
 *   GET  /v1/shifts/change-requests/my                → ShiftChangeRequestResponse[]
 *   POST /v1/shifts/change-requests/{id}/cancel       → withdraw my waiting request (BW-34)
 *
 * Once approved, the new shift starts on the chosen day, and runs until "Until" when one is given
 * (then the previous shift comes back). A request still pending after its start day is rejected
 * automatically and the employee applies again. Rotations and swaps are on hold.
 */

interface MeResponse { id: string; companyId: string }

interface ShiftPolicy {
  id: string
  name: string
  startTime?: string
  endTime?: string
  gracePeriodMinutes?: number
  /** ISO 1 = Mon … 7 = Sun; null when not set. */
  weeklyOffDays?: number[] | null
  /** People on this shift today (BW-32); null on older servers. */
  employeeCount?: number | null
}

interface CurrentShift {
  employeeId: string
  shiftPolicyId?: string
  shiftName?: string
  startTime?: string
  endTime?: string
  gracePeriodMinutes?: number
  /** A change HR already scheduled to start after today. */
  upcomingShiftPolicyId?: string | null
  upcomingShiftName?: string | null
  upcomingEffectiveFrom?: string | null
}

const STATUS: Record<string, [string, StatusTone]> = {
  PENDING: ['Waiting', 'warning'], APPROVED: ['Approved', 'success'], REJECTED: ['Rejected', 'danger'], CANCELLED: ['Withdrawn', 'muted'],
}
const REASON_MAX = 500

function requestDates(r: ChangeRequest): string {
  if (r.status === 'APPROVED' && r.appliedEffectiveDate) return changeDates(r.appliedEffectiveDate, r.requestedEndDate ?? null)
  if (r.requestedEffectiveDate) return changeDates(r.requestedEffectiveDate, r.requestedEndDate ?? null)
  return ''
}

export const ShiftChangeRequest = () => {
  const qc = useQueryClient()
  const toast = useToast()
  const today = istToday()
  const maxDate = addDays(today, 365)

  const me = useQuery({ queryKey: ['employee', 'me'], queryFn: () => apiJson<MeResponse>('/v1/employees/me'), staleTime: 60_000 })
  const companyId = me.data?.companyId
  const myId = me.data?.id
  const current = useQuery({
    queryKey: ['shifts', 'employee', myId], queryFn: () => apiJson<CurrentShift>(`/v1/shifts/employee/${myId}`), enabled: !!myId, staleTime: 60_000,
  })
  const shifts = useQuery({
    queryKey: ['shifts', 'company', companyId], queryFn: () => apiJson<ShiftPolicy[]>(`/v1/shifts?companyId=${companyId}`), enabled: !!companyId, staleTime: 60_000,
  })
  const mine = useMyShiftChanges()
  const approver = useApprovers('shift')
  const ask = useRequestShiftChange()
  const withdraw = useWithdrawShiftChange()

  const [picked, setPicked] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [withdrawing, setWithdrawing] = useState<ChangeRequest | null>(null)

  // A change HR already scheduled blocks earlier start days (the server refuses them), and from that
  // day on it is the shift being replaced.
  const upcomingFrom = current.data?.upcomingEffectiveFrom ?? null
  const scheduled = upcomingFrom && upcomingFrom > today ? upcomingFrom : null
  const minDate = scheduled ?? today
  const tomorrow = addDays(today, 1)
  const start = from ?? (minDate > tomorrow ? minDate : tomorrow)
  const baselineId = scheduled ? current.data?.upcomingShiftPolicyId ?? undefined : current.data?.shiftPolicyId
  const requests = useMemo(() => mine.data ?? [], [mine.data])
  const pending = requests.find((r) => r.status === 'PENDING') ?? null
  const options = shifts.data ?? []
  const target = options.find((s) => s.id === picked) ?? null
  const problem = shiftProblem({ picked, from: start, until, reason, min: minDate, max: maxDate, scheduled })
  const who = approver.data?.approver?.name ?? null

  async function send() {
    setTried(true)
    if (problem || !picked) return
    try {
      const res = await ask.mutateAsync({ requestedShiftPolicyId: picked, effectiveDate: start, reason: reason.trim(), endDate: until || null })
      if (!res.available) { toast.error('“Until” isn’t switched on yet. Leave it empty to ask for a lasting change.'); return }
      void qc.invalidateQueries({ queryKey: ['ess'] })
      toast.success(`Sent${who ? ` to ${who}` : ' to HR'}: move to ${target?.name ?? 'the new shift'} ${changeDates(start, until || null).replace(/^From/, 'from')}`)
      setPicked(null); setFrom(null); setUntil(''); setReason(''); setTried(false)
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t send the request. Try again.'))
    }
  }

  async function doWithdraw() {
    if (!withdrawing) return
    try {
      const res = await withdraw.mutateAsync(withdrawing.id)
      if (!res.available) { toast.error('Withdrawing isn’t switched on yet. Ask HR to reject it instead.'); return }
      void qc.invalidateQueries({ queryKey: ['ess'] })
      toast.success('Request withdrawn')
      setWithdrawing(null)
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t withdraw the request.'))
    }
  }

  const cur = current.data
  const sub = cur?.shiftName
    ? `You work the ${cur.shiftName} shift${timeRange(cur.startTime, cur.endTime) ? `, ${timeRange(cur.startTime, cur.endTime).replace('–', ' to ')}` : ''}${cur.gracePeriodMinutes ? ` with ${cur.gracePeriodMinutes} minutes’ grace` : ''}. Pick another shift to ask ${who ?? 'HR'} to move you.`
    : `You’re on the default shift. Pick a shift to ask ${who ?? 'HR'} to move you.`

  return (
    <PageFrame width="narrow" label="Shift change">
      <PageHeader title="Shift change" sub={current.isLoading ? undefined : sub} />

      {scheduled && (
        <Callout tone="info" icon="calendar">Your shift changes to {cur?.upcomingShiftName ?? 'another shift'} on {fmtShort(scheduled)}.</Callout>
      )}

      <Section variant="panel" title="Shifts" body="default" loading={shifts.isLoading || me.isLoading} error={shifts.error ?? me.error}
        onRetry={() => { void me.refetch(); void shifts.refetch() }} skeleton="text"
        empty={shifts.isSuccess && !options.length ? { title: 'No shifts set up yet', hint: 'HR adds shifts in Shifts & overtime.', icon: 'swap' } : undefined}>
        <div className="us-cards" role="group" aria-label="Shifts">
          {options.map((s) => {
            const mineNow = s.id === baselineId
            const meta = [workDays(s.weeklyOffDays), peopleWord(s.employeeCount)].filter(Boolean).join(' · ')
            return (
              <button key={s.id} type="button" className="us-card" aria-pressed={picked === s.id} disabled={mineNow || !!pending}
                onClick={() => setPicked(picked === s.id ? null : s.id)}>
                <span className="us-card__top">
                  <span className="us-card__name">{s.name}</span>
                  {mineNow && <StatusPill tone="brand" size="xs">Your shift</StatusPill>}
                </span>
                <span className="us-card__time">{timeRange(s.startTime, s.endTime) || 'No set hours'}</span>
                <span className="us-bar" aria-hidden="true">
                  {barSegments(s.startTime, s.endTime).map((g, i) => <span key={i} style={{ left: `${g.left}%`, width: `${g.width}%` }} />)}
                </span>
                <span className="us-bar__ticks" aria-hidden="true"><span>00:00</span><span>12:00</span><span>24:00</span></span>
                {meta && <span className="us-card__meta">{meta}</span>}
              </button>
            )
          })}
        </div>
      </Section>

      <div className="uw-cols">
        {pending ? (
          <Section variant="panel" title="Your request is waiting">
            <div className="uw-form">
              <Callout tone="warning" icon="clock">
                You asked to move to {pending.requestedShiftName ?? 'another shift'}{requestDates(pending) ? ` (${requestDates(pending)})` : ''}.
                {pending.approverName ? ` It’s with ${pending.approverName}.` : ''} Wait for a decision, or withdraw it to ask for something else.
              </Callout>
              <div><Button variant="secondary" size={38} onClick={() => setWithdrawing(pending)}>Withdraw</Button></div>
            </div>
          </Section>
        ) : (
          <Section variant="panel" title={target ? `Move to the ${target.name} shift` : 'Pick a different shift above'}>
            <div className="uw-form">
              <div className="us-dates">
                <DateInput label="From" required min={minDate} max={maxDate} value={start} disabled={!target} onChange={(e) => setFrom(e.target.value || null)} />
                <DateInput label="Until (optional)" min={start} max={maxDate} value={until} disabled={!target} hint="Leave empty to stay on it"
                  onChange={(e) => setUntil(e.target.value)} />
              </div>
              <Textarea label="Why do you need it?" required rows={2} maxLength={REASON_MAX} value={reason} disabled={!target}
                placeholder="For example: covering a release window" hint={`${reason.trim().length}/${REASON_MAX}`}
                error={tried && target && problem ? problem : undefined} onChange={(e) => setReason(e.target.value)} />
              <span style={{ fontSize: 12.5, color: 'var(--u-ink3, #6A7A73)' }}>If it isn’t approved by the start day, the request expires and you can send a new one.</span>
              <div className="uw-foot">
                <span className="uw-foot__line">{tried && !target ? 'Pick a shift to move to.' : target ? `${target.name} · ${changeDates(start, until || null)}` : ''}</span>
                <Button variant="primary" size={40} icon="swap" loading={ask.isPending} disabled={!target} onClick={() => void send()}>Send to {who ?? 'HR'}</Button>
              </div>
            </div>
          </Section>
        )}

        <Section variant="panel" title="Past changes" body="list" loading={mine.isLoading} error={mine.error} onRetry={() => mine.refetch()}
          empty={!requests.length ? { title: 'No shift changes yet', hint: 'Requests you send show here with the decision.', icon: 'swap' } : undefined}>
          <ListRows label="Your shift change requests">
            {requests.map((r) => {
              const [label, tone] = STATUS[r.status] ?? [r.status, 'muted' as StatusTone]
              const line = [
                requestDates(r),
                r.decisionNote ? (r.approverId ? `${r.approverName ?? 'HR'}: “${r.decisionNote}”` : r.decisionNote) : r.reason ? `“${r.reason}”` : '',
                `sent ${sentWhen(r.createdAt, today)}`,
              ].filter(Boolean).join(' · ')
              return (
                <ListRow key={r.id} variant="divided" density="default"
                  title={`${r.currentShiftName ? `${r.currentShiftName} → ` : ''}${r.requestedShiftName ?? 'Shift'}`} sub={line}
                  end={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <StatusPill tone={tone} size="sm">{label}</StatusPill>
                    {r.status === 'PENDING' && <Button size={30} variant="ghost" onClick={() => setWithdrawing(r)}>Withdraw</Button>}
                  </span>} />
              )
            })}
          </ListRows>
        </Section>
      </div>

      <Dialog open={!!withdrawing} onClose={() => setWithdrawing(null)} busy={withdraw.isPending} tone="danger" icon="swap" closeLabel="Close panel"
        title="Withdraw this request?" sub={withdrawing ? `Move to ${withdrawing.requestedShiftName ?? 'another shift'}${requestDates(withdrawing) ? `, ${requestDates(withdrawing)}` : ''}.` : undefined}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setWithdrawing(null)}>Keep it</PanelButton>
          <PanelButton variant="danger" busy={withdraw.isPending} onClick={() => void doWithdraw()}>Withdraw</PanelButton>
        </>} />
    </PageFrame>
  )
}

export default ShiftChangeRequest
