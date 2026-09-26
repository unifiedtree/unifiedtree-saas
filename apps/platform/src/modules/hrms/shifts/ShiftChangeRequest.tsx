import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addYears, format, parseISO } from 'date-fns'
import { apiJson } from '@/core/api/client'
import { Field } from '@unifiedtree/ui-kit'
import { DateField } from '@/shared/components/calendar'
import { HrButton, HrSelect, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { ModulePage, Panel, Facts, Note, SubHeading, State, RowList, Row } from '@/design/module/ModuleKit'

/**
 * Employee-facing shift-change request (web mirror of Attendance_App/app/shift-change.tsx).
 *
 * Backend endpoints (com.hrms.api.attendance.ShiftController):
 *   GET  /v1/shifts?companyId=…                → ShiftPolicyResponse[]
 *   GET  /v1/shifts/employee/{employeeId}      → EmployeeShiftResponse (current)
 *   POST /v1/shifts/change-requests            → CreateShiftChangeRequest
 *   GET  /v1/shifts/change-requests/my         → ShiftChangeRequestResponse[]
 *
 * The request carries { requestedShiftPolicyId, effectiveDate, reason }. Once
 * approved, the new shift starts on effectiveDate. A request still pending
 * after that date is rejected automatically and the employee applies again.
 */

interface MeResponse {
  id: string
  companyId: string
  firstName?: string
  lastName?: string
}

interface ShiftPolicy {
  id: string
  name: string
  startTime?: string
  endTime?: string
  gracePeriodMinutes?: number
}

interface CurrentShift {
  employeeId: string
  shiftPolicyId?: string
  shiftName?: string
  startTime?: string
  endTime?: string
  /** A change HR already scheduled to start after today. */
  upcomingShiftPolicyId?: string | null
  upcomingShiftName?: string | null
  upcomingEffectiveFrom?: string | null
}

interface ChangeRequest {
  id: string
  currentShiftPolicyId?: string
  currentShiftName?: string
  requestedShiftPolicyId: string
  requestedShiftName?: string
  reason?: string
  status: string
  decisionNote?: string
  decidedAt?: string
  createdAt: string
  /** Null when the request was rejected automatically (expired). */
  approverId?: string | null
  requestedEffectiveDate?: string | null
  appliedEffectiveDate?: string | null
}

const STATUS_TONE: Record<string, PillTone> = {
  APPROVED: 'ok',
  PENDING: 'warn',
  REJECTED: 'red',
  CANCELLED: 'gray',
}

const hhmm = (t?: string) => (t ? t.slice(0, 5) : '')

const formatShiftRange = (start?: string, end?: string) =>
  start && end ? `${hhmm(start)} – ${hhmm(end)}` : ''

const tomorrowIso = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return format(d, 'yyyy-MM-dd')
}

const todayIso = () => format(new Date(), 'yyyy-MM-dd')
const yearAheadIso = () => format(addYears(new Date(), 1), 'yyyy-MM-dd')
const longDate = (iso: string) => format(parseISO(iso), 'd MMM yyyy')

const REASON_MIN = 10
const REASON_MAX = 500

export const ShiftChangeRequest: React.FC = () => {
  const qc = useQueryClient()

  const [requestedShiftId, setRequestedShiftId] = useState('')
  // null until the employee picks a date; the default depends on the shift data.
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const me = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: () => apiJson<MeResponse>('/v1/employees/me'),
    staleTime: 60_000,
  })
  const companyId = me.data?.companyId
  const myId = me.data?.id

  const current = useQuery({
    queryKey: ['shifts', 'employee', myId],
    queryFn: () => apiJson<CurrentShift>(`/v1/shifts/employee/${myId}`),
    enabled: !!myId,
    staleTime: 60_000,
  })

  const shifts = useQuery({
    queryKey: ['shifts', 'company', companyId],
    queryFn: () => apiJson<ShiftPolicy[]>(`/v1/shifts?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  })

  const myRequests = useQuery({
    queryKey: ['shifts', 'change-requests', 'my'],
    queryFn: () => apiJson<ChangeRequest[]>('/v1/shifts/change-requests/my'),
  })

  const currentShiftId = current.data?.shiftPolicyId
  const currentShiftName = current.data?.shiftName
  const currentShiftRange = formatShiftRange(current.data?.startTime, current.data?.endTime)

  // A change HR already scheduled blocks earlier start dates (the server
  // refuses them), and from that date on it is the shift being replaced.
  const today = todayIso()
  const upcomingFrom = current.data?.upcomingEffectiveFrom ?? null
  const scheduledChange = upcomingFrom && upcomingFrom > today ? upcomingFrom : null
  const minDate = scheduledChange ?? today
  const maxDate = yearAheadIso()
  const tomorrow = tomorrowIso()
  const effectiveDate = pickedDate ?? (minDate > tomorrow ? minDate : tomorrow)
  const baselineShiftId = scheduledChange ? current.data?.upcomingShiftPolicyId ?? undefined : currentShiftId

  const availableShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.id !== baselineShiftId),
    [shifts.data, baselineShiftId],
  )

  const hasPending = (myRequests.data ?? []).some((r) => r.status === 'PENDING')

  const submit = useMutation({
    mutationFn: () =>
      apiJson<ChangeRequest>('/v1/shifts/change-requests', {
        method: 'POST',
        body: JSON.stringify({
          requestedShiftPolicyId: requestedShiftId,
          effectiveDate,
          reason: reason.trim(),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts', 'change-requests'] })
      setRequestedShiftId('')
      setReason('')
      setPickedDate(null)
      setError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message
      setError(msg || 'Could not submit request. Please try again.')
    },
  })

  const validate = (): string | null => {
    if (!requestedShiftId) return 'Please select a shift to switch to.'
    if (requestedShiftId === baselineShiftId) return 'Requested shift must be different from your current shift.'
    if (!effectiveDate) return 'Please pick an effective date.'
    // ISO dates compare as strings (local timezone).
    if (effectiveDate < today) return 'Effective date cannot be in the past.'
    if (scheduledChange && effectiveDate < scheduledChange) {
      return `Your shift is already scheduled to change on ${longDate(scheduledChange)}. Choose that date or a later one.`
    }
    if (effectiveDate > maxDate) return 'Effective date must be within the next 12 months.'
    const trimmed = reason.trim()
    if (trimmed.length < REASON_MIN) return `Reason must be at least ${REASON_MIN} characters.`
    if (trimmed.length > REASON_MAX) return `Reason must be at most ${REASON_MAX} characters.`
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setError(null)
    submit.mutate()
  }

  const disableForm = hasPending || availableShifts.length === 0 || !myId || !companyId
  const pendingReq = (myRequests.data ?? []).find((r) => r.status === 'PENDING')
  const statusLabel = (s: string) => (s === 'PENDING' ? 'Pending' : s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : s === 'CANCELLED' ? 'Cancelled' : s)

  return (
    <ModulePage crumb="My workspace" title="Shift change" subtitle="Ask HR to move you to a different shift. They approve or reject it, and you’re notified.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 16, alignItems: 'start' }}>
        <Panel title="Your shift" sub={current.isLoading ? 'Loading…' : undefined}>
          <Facts items={[
            { k: 'Now', v: currentShiftName ? `${currentShiftName}${currentShiftRange ? ` · ${currentShiftRange}` : ''}` : 'Default (not assigned)' },
            ...(scheduledChange ? [{ k: 'Scheduled', v: `${current.data?.upcomingShiftName ?? 'Another shift'} from ${longDate(scheduledChange)}` }] : []),
          ]} min={200} />
          {hasPending && pendingReq && <Note tone="amber">{`You asked for ${pendingReq.requestedShiftName ?? 'another shift'} on ${longDate(pendingReq.createdAt.slice(0, 10))}. Wait for HR to decide before sending another request.`}</Note>}
        </Panel>
        {!hasPending && (
          <Panel title="New request" sub="The new shift starts on the date you choose once HR approves it.">
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Shift you want *</span>
                <HrSelect value={requestedShiftId} onChange={setRequestedShiftId} disabled={disableForm || shifts.isLoading} placeholder={shifts.isLoading ? 'Loading…' : 'Choose a shift'}
                  options={availableShifts.map((s) => ({ value: s.id, label: `${s.name}${s.startTime ? ` · ${formatShiftRange(s.startTime, s.endTime)}` : ''}` }))} />
                {availableShifts.length === 0 && shifts.isSuccess && <span style={{ fontSize: 12.5, color: '#64748b' }}>There are no other shifts to move to.</span>}
              </div>
              <div style={{ maxWidth: 220 }}><Field label="Starting from *"><DateField min={minDate} max={maxDate} value={effectiveDate} disabled={disableForm} onChange={(e) => setPickedDate(e.target.value)} /></Field></div>
              <Note>If HR hasn’t approved it by that date, the request expires and you can send a new one.</Note>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: '#334155' }}>Reason *<span style={{ fontWeight: 500, color: '#94a3b8' }}>{reason.trim().length}/{REASON_MAX}</span></span>
                <textarea rows={3} maxLength={REASON_MAX} value={reason} disabled={disableForm} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters"
                  style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
              </label>
              {error && <Note tone="red">{error}</Note>}
              {submit.isSuccess && <Note tone="green">Request sent. HR will review it and you’ll be notified.</Note>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                <HrButton type="submit" disabled={disableForm || submit.isPending}>{submit.isPending ? 'Sending…' : 'Send request to HR'}</HrButton>
              </div>
            </form>
          </Panel>
        )}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <SubHeading>Your requests</SubHeading>
        {myRequests.isLoading ? <State kind="loading" />
          : myRequests.error ? <State kind="error" title="Couldn’t load your requests" onRetry={() => myRequests.refetch()} />
            : (myRequests.data ?? []).length === 0 ? <State kind="empty" icon="swap" title="No shift-change requests yet" description="Requests you send appear here with HR’s decision." />
              : (
                <RowList>
                  {(myRequests.data ?? []).map((r) => (
                    <Row key={r.id} title={`${r.currentShiftName ? `${r.currentShiftName} → ` : ''}${r.requestedShiftName ?? 'Shift'}`}
                      meta={[r.status === 'APPROVED' && r.appliedEffectiveDate ? `Starts ${longDate(r.appliedEffectiveDate)}` : r.requestedEffectiveDate ? `Asked to start ${longDate(r.requestedEffectiveDate)}` : null, `sent ${longDate(r.createdAt.slice(0, 10))}`].filter(Boolean).join(' · ')}
                      note={r.decisionNote ? (r.approverId ? `HR: “${r.decisionNote}”` : r.decisionNote) : r.reason ? `“${r.reason}”` : undefined}
                      trail={<HrStatusPill tone={STATUS_TONE[r.status] ?? 'gray'}>{statusLabel(r.status)}</HrStatusPill>} />
                  ))}
                </RowList>
              )}
      </div>
    </ModulePage>
  )
}

export default ShiftChangeRequest
