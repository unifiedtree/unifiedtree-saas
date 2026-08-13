import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Clock } from 'lucide-react'
import { apiJson } from '@/core/api/client'
import { HrPageHeader, HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'

/**
 * Employee-facing shift-change request (web mirror of Attendance_App/app/shift-change.tsx).
 *
 * Backend endpoints (com.hrms.api.attendance.ShiftController):
 *   GET  /v1/shifts?companyId=…                → ShiftPolicyResponse[]
 *   GET  /v1/shifts/employee/{employeeId}      → EmployeeShiftResponse (current)
 *   POST /v1/shifts/change-requests            → CreateShiftChangeRequest
 *   GET  /v1/shifts/change-requests/my         → ShiftChangeRequestResponse[]
 *
 * The backend CreateShiftChangeRequest DTO accepts { requestedShiftPolicyId, reason }.
 * We also send `effectiveDate` in the body per the parity spec — Jackson ignores
 * unknown fields, so this is forward-compatible when the backend adds the column.
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

const REASON_MIN = 10
const REASON_MAX = 500

export const ShiftChangeRequest: React.FC = () => {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [requestedShiftId, setRequestedShiftId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(tomorrowIso())
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

  const availableShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.id !== currentShiftId),
    [shifts.data, currentShiftId],
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
      setEffectiveDate(tomorrowIso())
      setError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message
      setError(msg || 'Could not submit request. Please try again.')
    },
  })

  const validate = (): string | null => {
    if (!requestedShiftId) return 'Please select a shift to switch to.'
    if (requestedShiftId === currentShiftId) return 'Requested shift must be different from your current shift.'
    if (!effectiveDate) return 'Please pick an effective date.'
    // Compare as ISO dates in local timezone: reject anything before today.
    const today = format(new Date(), 'yyyy-MM-dd')
    if (effectiveDate < today) return 'Effective date cannot be in the past.'
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <HrPageHeader
        crumb="Employee Self-Service"
        title="Request a Shift Change"
        subtitle="Ask HR to move you to a different shift. HR will review and approve or reject."
        actions={
          <HrButton variant="ghost" size="sm" onClick={() => navigate('/me')}>
            <ArrowLeft size={14} /> Back
          </HrButton>
        }
      />

      {/* Current shift (read-only) */}
      <div className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Current shift</p>
        <div className="mt-1 flex items-center gap-2">
          <Clock size={16} className="text-text-tertiary" />
          <p className="text-base font-semibold text-text-primary">
            {currentShiftName ? `${currentShiftName}${currentShiftRange ? ` · ${currentShiftRange}` : ''}` : 'Default (unassigned)'}
          </p>
        </div>
      </div>

      {/* Pending banner */}
      {hasPending && (
        <div className="rounded-2xl border border-[#FBBF24] bg-[#FFFBEB] p-4 text-sm text-[#78350F]">
          You already have a pending shift-change request. Please wait for HR to decide before sending another.
        </div>
      )}

      {/* Form */}
      {!hasPending && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border-default bg-white p-4 shadow-sm sm:p-6">
          <div>
            <label htmlFor="scr-shift" className="mb-1 block text-sm font-medium text-text-primary">
              Requested shift <span className="text-[#DC2626]">*</span>
            </label>
            <select
              id="scr-shift"
              required
              value={requestedShiftId}
              onChange={(e) => setRequestedShiftId(e.target.value)}
              disabled={disableForm || shifts.isLoading}
              className="w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none disabled:bg-bg-base disabled:text-text-tertiary"
            >
              <option value="">— Select a shift —</option>
              {availableShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.startTime ? ` · ${formatShiftRange(s.startTime, s.endTime)}` : ''}
                </option>
              ))}
            </select>
            {availableShifts.length === 0 && shifts.isSuccess && (
              <p className="mt-1 text-xs text-text-tertiary">No other shifts available to switch to.</p>
            )}
          </div>

          <div>
            <label htmlFor="scr-date" className="mb-1 block text-sm font-medium text-text-primary">
              Effective from <span className="text-[#DC2626]">*</span>
            </label>
            <input
              id="scr-date"
              type="date"
              required
              min={format(new Date(), 'yyyy-MM-dd')}
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={disableForm}
              className="w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none disabled:bg-bg-base disabled:text-text-tertiary"
            />
            <p className="mt-1 text-xs text-text-tertiary">Defaults to tomorrow. Cannot be in the past.</p>
          </div>

          <div>
            <label htmlFor="scr-reason" className="mb-1 block text-sm font-medium text-text-primary">
              Reason <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              id="scr-reason"
              required
              rows={4}
              minLength={REASON_MIN}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={disableForm}
              placeholder="Why do you want to change shift?"
              className="w-full resize-y rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none disabled:bg-bg-base disabled:text-text-tertiary"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-text-tertiary">
              <span>Minimum {REASON_MIN} characters.</span>
              <span>{reason.trim().length}/{REASON_MAX}</span>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          {submit.isSuccess && (
            <div className="rounded-lg border border-[#6EE7B7] bg-[#ECFDF5] px-3 py-2 text-sm text-[#065F46]">
              Request sent. HR will review and notify you.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <HrButton type="button" variant="ghost" onClick={() => navigate('/me')} disabled={submit.isPending}>
              Cancel
            </HrButton>
            <HrButton type="submit" variant="primary" disabled={disableForm || submit.isPending}>
              {submit.isPending ? 'Sending…' : 'Send request to HR'}
            </HrButton>
          </div>
        </form>
      )}

      {/* Past requests */}
      <div className="rounded-2xl border border-border-default bg-white shadow-sm">
        <div className="border-b border-border-default px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">My shift-change requests</h2>
        </div>
        {(myRequests.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-tertiary">Your shift-change requests will appear here.</p>
        ) : (
          <ul className="divide-y divide-border-default/40">
            {(myRequests.data ?? []).map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {r.requestedShiftName ?? 'Shift'}
                    </p>
                    {r.currentShiftName && (
                      <p className="mt-0.5 text-xs text-text-secondary">From {r.currentShiftName}</p>
                    )}
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      Submitted {format(new Date(r.createdAt), 'd MMM yyyy')}
                    </p>
                  </div>
                  <HrStatusPill tone={STATUS_TONE[r.status] ?? 'gray'}>{r.status}</HrStatusPill>
                </div>
                {r.reason && <p className="mt-2 text-xs italic text-text-secondary">"{r.reason}"</p>}
                {r.decisionNote && (
                  <p className="mt-1 text-xs text-text-secondary">HR: {r.decisionNote}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default ShiftChangeRequest
