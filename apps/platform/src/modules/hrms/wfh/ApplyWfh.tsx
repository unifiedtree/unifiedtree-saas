import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Home, CalendarRange, AlertCircle, Send, CheckCircle, XCircle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import {
  useMyWfhRequests, useApplyWfh, useCancelWfh,
  type WfhApprovalStatus, type WfhRequestResponse,
} from '../api/useWfh'

// ────────────────────────────────────────────────────────────────────────────
// Employee "Apply for Work From Home" — mirrors Attendance_App/app/wfh-apply.tsx
// 1:1 so a desk employee gets the same guard rails a mobile employee gets:
//   • startDate required, defaults to today, no past dates
//   • endDate required, must be >= startDate, defaults to today
//   • reason required textarea, min 10 / max 500 chars
//   • Client-side overlap check against existing PENDING / APPROVED WFHs
// Backend endpoints live under com.hrms.api.wfh (POST /v1/wfh, GET /v1/wfh/my,
// POST /v1/wfh/{id}/cancel). Same DTO shape the mobile app uses.
// ────────────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<WfhApprovalStatus, { label: string; color: string; bg: string; icon: React.ElementType; tone: PillTone }> = {
  PENDING:    { label: 'Pending',     color: 'text-[#B45309]', bg: 'bg-[#FEF3C7]', icon: Clock,       tone: 'warn' },
  APPROVED:   { label: 'Approved',    color: 'text-[#15803D]', bg: 'bg-[#DCFCE7]', icon: CheckCircle, tone: 'ok' },
  REJECTED:   { label: 'Rejected',    color: 'text-[#B91C1C]', bg: 'bg-[#FEE2E2]', icon: XCircle,     tone: 'red' },
  CANCELLED:  { label: 'Cancelled',   color: 'text-[#6B7280]', bg: 'bg-[#F4F4F6]', icon: XCircle,     tone: 'gray' },
  PENDING_L2: { label: 'Awaiting HR', color: 'text-[#7C3AED]', bg: 'bg-[#F3E8FF]', icon: Clock,       tone: 'purple' },
}

// Local yyyy-MM-dd of today, matching the mobile getLocalToday() shape.
function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Compare ISO yyyy-MM-dd strings without spinning up a Date.
function dateKey(iso: string): number {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  return y * 10000 + m * 100 + d
}

function dayCountInclusive(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso) return 0
  const [sy, sm, sd] = fromIso.split('-').map((n) => parseInt(n, 10))
  const [ey, em, ed] = toIso.split('-').map((n) => parseInt(n, 10))
  const sMs = Date.UTC(sy, sm - 1, sd)
  const eMs = Date.UTC(ey, em - 1, ed)
  if (eMs < sMs) return 0
  return Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1
}

function prettyDDMM(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return iso
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

export const ApplyWfh: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()

  const today = useMemo(() => todayIso(), [])

  // Default both dates to today so the CTA is enabled the moment a reason is
  // typed — matches how the mobile screen pre-fills once you touch it.
  const [fromDate, setFromDate] = useState<string>(today)
  const [toDate, setToDate] = useState<string>(today)
  const [reason, setReason] = useState<string>('')

  const { data: myRequestsPage, isLoading: myLoading } = useMyWfhRequests(0, 100)
  const applyMutation = useApplyWfh()
  const cancelMutation = useCancelWfh()

  const overlappingRequest = useMemo<WfhRequestResponse | null>(() => {
    if (!fromDate || !toDate || !myRequestsPage?.content?.length) return null
    const sKey = dateKey(fromDate)
    const eKey = dateKey(toDate)
    return myRequestsPage.content.find((r) => {
      if (r.status !== 'PENDING' && r.status !== 'APPROVED' && r.status !== 'PENDING_L2') return false
      if (!r.fromDate || !r.toDate) return false
      const rsKey = dateKey(r.fromDate)
      const reKey = dateKey(r.toDate)
      return rsKey <= eKey && reKey >= sKey
    }) ?? null
  }, [fromDate, toDate, myRequestsPage])

  const dayCount = useMemo(() => dayCountInclusive(fromDate, toDate), [fromDate, toDate])

  const endBeforeStart = !!fromDate && !!toDate && dateKey(toDate) < dateKey(fromDate)
  const startInPast = !!fromDate && dateKey(fromDate) < dateKey(today)
  const reasonTrimmed = reason.trim()
  const reasonTooShort = reasonTrimmed.length < 10
  const reasonTooLong = reason.length > 500

  const disabledReason: string | null =
    !fromDate ? 'Pick a start date'
    : !toDate ? 'Pick an end date'
    : startInPast ? 'Start date cannot be in the past'
    : endBeforeStart ? 'End date must be on or after the start date'
    : reasonTooShort ? 'Reason needs at least 10 characters'
    : reasonTooLong ? 'Reason must be 500 characters or fewer'
    : overlappingRequest ? 'You already have a WFH request on these dates'
    : null

  const submit = async () => {
    if (disabledReason) {
      toast(disabledReason, 'error')
      return
    }
    try {
      await applyMutation.mutateAsync({
        fromDate,
        toDate,
        reason: reasonTrimmed,
      })
      toast('WFH request submitted', 'success')
      setReason('')
      setFromDate(today)
      setToDate(today)
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to submit WFH request', 'error')
    }
  }

  const cancel = async (id: string) => {
    try {
      await cancelMutation.mutateAsync(id)
      toast('WFH request cancelled', 'success')
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to cancel WFH request', 'error')
    }
  }

  const recent = (myRequestsPage?.content ?? []).slice(0, 10)

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8 space-y-6">
      <button
        onClick={() => navigate('/me')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Back to dashboard
      </button>

      <HrPageHeader
        crumb="Employee Self-Service"
        title="Apply for Work From Home"
        subtitle="Request approval to work from home for one or more days"
      />

      {/* Info banner — mirrors the mobile info card */}
      <div className="rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
            <Home size={18} className="text-[#059669]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#064E3B]">Work From Home</p>
            <p className="text-xs text-[#065F46] mt-0.5">
              Once approved, you can punch in from anywhere on the covered dates — the
              location check is skipped, but face verification still runs as normal.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="ut-card ut-card-lg p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Select WFH Dates</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Start Date *</label>
              <input
                type="date"
                required
                min={today}
                value={fromDate}
                onChange={(e) => {
                  const v = e.target.value
                  setFromDate(v)
                  // If the user pushes start past the current end, bump end forward
                  // — matches mobile behaviour so the range never inverts silently.
                  if (v && toDate && dateKey(toDate) < dateKey(v)) setToDate(v)
                }}
                className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">End Date *</label>
              <input
                type="date"
                required
                min={fromDate || today}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {endBeforeStart ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#FEE2E2] px-3 py-2">
              <AlertCircle size={14} className="text-[#B91C1C]" />
              <p className="text-xs font-medium text-[#B91C1C]">End date must be on or after the start date.</p>
            </div>
          ) : startInPast ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#FEE2E2] px-3 py-2">
              <AlertCircle size={14} className="text-[#B91C1C]" />
              <p className="text-xs font-medium text-[#B91C1C]">Start date cannot be in the past.</p>
            </div>
          ) : overlappingRequest ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#FEE2E2] px-3 py-2">
              <AlertCircle size={14} className="text-[#B91C1C]" />
              <p className="text-xs font-medium text-[#B91C1C]">
                Overlaps with WFH on {prettyDDMM(overlappingRequest.fromDate)} – {prettyDDMM(overlappingRequest.toDate)} ({overlappingRequest.status})
              </p>
            </div>
          ) : dayCount > 0 ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#ECFDF5] px-3 py-2">
              <CalendarRange size={14} className="text-[#059669]" />
              <p className="text-xs font-medium text-[#065F46]">
                {dayCount} day{dayCount !== 1 ? 's' : ''} of Work From Home
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="block text-[13px] font-semibold text-text-secondary">Reason / Notes *</label>
            <span className={clsx('text-[11px]', reason.length > 0 && reasonTooShort ? 'text-danger' : 'text-text-tertiary')}>
              {reason.length}/500{reason.length > 0 && reasonTooShort ? '  ·  min 10' : ''}
            </span>
          </div>
          <textarea
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Briefly explain why you need to work from home..."
            className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary resize-none"
          />
        </div>

        {disabledReason && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <AlertCircle size={14} className="text-text-secondary" />
            <p className="text-xs font-medium text-text-secondary">{disabledReason}</p>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={applyMutation.isPending || !!disabledReason}
          className="w-full inline-flex items-center justify-center gap-2 py-3 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
        >
          <Send size={16} />
          {applyMutation.isPending ? 'Submitting...' : 'Submit Application'}
        </button>
      </div>

      {/* Recent WFH requests */}
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-3">Recent WFH Requests</h2>
        {myLoading ? (
          <CardSkeleton />
        ) : recent.length === 0 ? (
          <EmptyState
            variant="first-run"
            title="No WFH requests yet"
            description="Submit one above to see it here."
          />
        ) : (
          <div className="space-y-2">
            {recent.map((r) => {
              const sc = STATUS_STYLE[r.status] ?? STATUS_STYLE['PENDING']
              const canCancel = r.status === 'PENDING' || r.status === 'PENDING_L2'
              return (
                <div key={r.id} className="ut-card ut-card-sm px-4 py-3 flex items-center gap-4">
                  <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', sc.bg)}>
                    <sc.icon size={16} className={sc.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-text-primary font-medium text-sm">
                        {format(new Date(r.fromDate), 'd MMM')} – {format(new Date(r.toDate), 'd MMM yyyy')}
                      </p>
                      <HrStatusPill tone={sc.tone}>{sc.label}</HrStatusPill>
                    </div>
                    <p className="text-text-secondary text-xs mt-0.5">
                      {dayCountInclusive(r.fromDate, r.toDate)} day{dayCountInclusive(r.fromDate, r.toDate) !== 1 ? 's' : ''}
                      {r.reason ? ` · "${r.reason}"` : ''}
                    </p>
                    {r.decisionNote && (
                      <p className="text-text-tertiary text-xs mt-0.5 italic">Note: {r.decisionNote}</p>
                    )}
                  </div>
                  {canCancel && (
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={cancelMutation.isPending}
                      className="text-xs text-text-secondary hover:text-danger transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ApplyWfh
