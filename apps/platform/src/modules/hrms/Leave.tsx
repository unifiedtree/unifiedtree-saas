import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Calendar, Plus, CheckCircle, XCircle, Clock, FileText, Check, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { usePermission, Can, P } from '@unifiedtree/sdk'
import { CardSkeleton, Skeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  useMyLeaves, useMyBalances, useLeaveTypes, usePendingApprovals,
  useApplyLeave, useLeaveDecision, useCancelLeave,
  type LeaveApprovalStatus, type LeaveDuration,
} from './api/useLeave'
import { useCompanies } from './api/useOrg'
import { LeaveTypes } from './leave/LeaveTypes'
import { HolidayCalendar } from './leave/HolidayCalendar'
import { HrPageHeader, HrStatusPill, type PillTone } from '@/shared/components/hr'

type Tab = 'my' | 'apply' | 'balances' | 'approvals' | 'types' | 'holidays'

const STATUS_STYLE: Record<LeaveApprovalStatus, { label: string; color: string; bg: string; icon: React.ElementType; tone: PillTone }> = {
  PENDING:    { label: 'Pending',     color: 'text-[#B45309]', bg: 'bg-[#FEF3C7]', icon: Clock,       tone: 'warn' },
  APPROVED:   { label: 'Approved',    color: 'text-[#15803D]', bg: 'bg-[#DCFCE7]', icon: CheckCircle, tone: 'ok' },
  REJECTED:   { label: 'Rejected',    color: 'text-[#B91C1C]', bg: 'bg-[#FEE2E2]', icon: XCircle,     tone: 'red' },
  CANCELLED:  { label: 'Cancelled',   color: 'text-[#6B7280]', bg: 'bg-[#F4F4F6]', icon: XCircle,     tone: 'gray' },
  PENDING_L2: { label: 'Awaiting HR', color: 'text-[#7C3AED]', bg: 'bg-[#F3E8FF]', icon: Clock,       tone: 'purple' },
}

// ── My Leaves Tab ─────────────────────────────────────────────────────────────

function MyLeavesTab() {
  const { toast } = useToast()
  const [page, setPage] = useState(0)
  const { data, isLoading, error: leavesError, refetch: refetchLeaves } = useMyLeaves(page)
  const cancelLeave = useCancelLeave()

  const leaves = data?.content ?? []
  const total = data?.totalElements ?? 0

  const handleCancel = async (id: string) => {
    try {
      await cancelLeave.mutateAsync({ requestId: id, reason: 'Cancelled by employee' })
      toast('Leave cancelled', 'success')
    } catch {
      toast('Failed to cancel leave', 'error')
    }
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <CardSkeleton />
      ) : leavesError ? (
        <EmptyState variant="error" title="Failed to load leaves" description={(leavesError as Error).message} primaryAction={{ label: 'Retry', onClick: () => refetchLeaves() }} />
      ) : leaves.length === 0 ? (
        <div className="text-center py-16">
          <FileText size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">No leave requests yet</p>
          <p className="text-text-tertiary text-xs mt-1">Use the Apply tab to request leave</p>
        </div>
      ) : (
        leaves.map((leave) => {
          const sc = STATUS_STYLE[leave.status] ?? STATUS_STYLE['PENDING']
          return (
            <div key={leave.id} className="bg-white border border-border-default rounded-2xl px-4 py-3 flex items-center gap-4">
              <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', sc.bg)}>
                <sc.icon size={16} className={sc.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-text-primary font-medium text-sm">{leave.leaveTypeName ?? 'Leave'}</p>
                  <HrStatusPill tone={sc.tone}>{sc.label}</HrStatusPill>
                </div>
                <p className="text-text-secondary text-xs mt-0.5">
                  {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM yyyy')}
                  {' · '}{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}
                </p>
                {leave.reason && <p className="text-text-tertiary text-xs truncate mt-0.5">"{leave.reason}"</p>}
              </div>
              {(leave.status === 'PENDING' || leave.status === 'APPROVED') && (
                <button
                  onClick={() => handleCancel(leave.id)}
                  disabled={cancelLeave.isPending}
                  className="text-xs text-text-secondary hover:text-danger transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Cancel
                </button>
              )}
            </div>
          )
        })
      )}

      {total > 20 && (
        <div className="flex justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="px-3 py-1.5 text-xs border border-border-default rounded-lg text-text-secondary disabled:opacity-30 hover:text-text-primary transition-colors">Prev</button>
          <span className="text-xs text-text-secondary py-1.5">Page {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= total} className="px-3 py-1.5 text-xs border border-border-default rounded-lg text-text-secondary disabled:opacity-30 hover:text-text-primary transition-colors">Next</button>
        </div>
      )}
    </div>
  )
}

// ── Apply Tab ─────────────────────────────────────────────────────────────────

function ApplyTab() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const activeCompany = companies[0]
  const { data: leaveTypes = [], isLoading: typesLoading } = useLeaveTypes(activeCompany?.id ?? '')
  const { data: myLeaves } = useMyLeaves(0)
  const { data: balances = [] } = useMyBalances(new Date().getFullYear())
  const applyLeave = useApplyLeave()

  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    duration: 'FULL_DAY' as LeaveDuration,
    reason: '',
  })

  const isHalfDay = form.duration === 'HALF_DAY_MORNING' || form.duration === 'HALF_DAY_AFTERNOON'

  // Half-day auto-force: keep endDate == startDate whenever half-day is selected.
  const effectiveEndDate = isHalfDay ? form.startDate : form.endDate

  const todayIso = new Date().toISOString().slice(0, 10)

  // Compute effective days: half-day counts as 0.5, else 1 per calendar day inclusive.
  const effectiveDays = React.useMemo(() => {
    if (!form.startDate || !effectiveEndDate) return 0
    if (isHalfDay) return 0.5
    const start = new Date(form.startDate + 'T00:00:00')
    const end = new Date(effectiveEndDate + 'T00:00:00')
    const diffMs = end.getTime() - start.getTime()
    if (isNaN(diffMs) || diffMs < 0) return 0
    return Math.floor(diffMs / 86_400_000) + 1
  }, [form.startDate, effectiveEndDate, isHalfDay])

  // Overlap check against existing PENDING/PENDING_L2/APPROVED leaves.
  const hasOverlap = React.useMemo(() => {
    if (!form.startDate || !effectiveEndDate) return false
    const reqStart = form.startDate
    const reqEnd = effectiveEndDate
    const existing = myLeaves?.content ?? []
    return existing.some((lv) => {
      if (lv.status !== 'PENDING' && lv.status !== 'PENDING_L2' && lv.status !== 'APPROVED') return false
      // Date-string comparison works because ISO YYYY-MM-DD is lexicographically ordered.
      return lv.startDate <= reqEnd && lv.endDate >= reqStart
    })
  }, [form.startDate, effectiveEndDate, myLeaves])

  // Balance check for the selected leave type.
  const selectedBalance = balances.find((b) => b.leaveTypeId === form.leaveTypeId)
  const availableBalance = selectedBalance?.available ?? null
  const exceedsBalance = availableBalance !== null && effectiveDays > 0 && effectiveDays > availableBalance

  const reasonTrimmedLen = form.reason.trim().length
  const reasonTooShort = reasonTrimmedLen > 0 && reasonTrimmedLen < 10
  const reasonMissing = reasonTrimmedLen === 0
  const REASON_MAX = 500

  const submitDisabled =
    applyLeave.isPending ||
    hasOverlap ||
    exceedsBalance ||
    !form.leaveTypeId ||
    !form.startDate ||
    !effectiveEndDate ||
    reasonMissing ||
    reasonTooShort

  const handleSubmit = async () => {
    if (!form.leaveTypeId || !form.startDate || !effectiveEndDate) {
      toast('Leave type and dates are required', 'error')
      return
    }
    if (form.startDate < todayIso) {
      toast('Leave start date cannot be in the past', 'error')
      return
    }
    if (effectiveEndDate < form.startDate) {
      toast('End date must be after start date', 'error')
      return
    }
    if (reasonMissing) {
      toast('Reason is required', 'error')
      return
    }
    if (reasonTooShort) {
      toast('Reason must be at least 10 characters', 'error')
      return
    }
    if (form.reason.length > REASON_MAX) {
      toast(`Reason must be at most ${REASON_MAX} characters`, 'error')
      return
    }
    if (hasOverlap) {
      toast('You already have a request for these dates', 'error')
      return
    }
    if (exceedsBalance) {
      toast('Requested days exceed available balance', 'error')
      return
    }
    try {
      await applyLeave.mutateAsync({
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: effectiveEndDate,
        duration: form.duration,
        reason: form.reason,
        companyId: activeCompany?.id,
      })
      toast('Leave request submitted', 'success')
      setForm({ leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '' })
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to apply for leave', 'error')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Leave Type *</label>
        {typesLoading ? (
          <Skeleton className="h-10 w-full rounded-xl" />
        ) : (
          <select
            value={form.leaveTypeId}
            onChange={(e) => setForm((p) => ({ ...p, leaveTypeId: e.target.value }))}
            className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
          >
            <option value="">Select leave type</option>
            {leaveTypes.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.annualEntitlement} days/year)</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Start Date *</label>
          <input
            type="date"
            min={todayIso}
            value={form.startDate}
            onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
            className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">End Date *</label>
          <input
            type="date"
            min={form.startDate || todayIso}
            value={effectiveEndDate}
            disabled={isHalfDay}
            onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary disabled:bg-surface-2 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Duration</label>
        <select
          value={form.duration}
          onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value as typeof form.duration }))}
          className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary"
        >
          <option value="FULL_DAY">Full Day</option>
          <option value="HALF_DAY_MORNING">Half Day (Morning)</option>
          <option value="HALF_DAY_AFTERNOON">Half Day (Afternoon)</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-medium text-text-secondary">Reason *</label>
          <span className={clsx('text-[10px]', form.reason.length > REASON_MAX ? 'text-danger' : 'text-text-tertiary')}>
            {form.reason.length}/{REASON_MAX}
          </span>
        </div>
        <textarea
          value={form.reason}
          onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value.slice(0, REASON_MAX) }))}
          rows={3}
          maxLength={REASON_MAX}
          placeholder="Reason for leave (min 10 characters)"
          className="w-full bg-white border border-border-default/60 rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary resize-none"
        />
        {reasonTooShort && (
          <p className="text-[11px] text-danger mt-1">Reason must be at least 10 characters</p>
        )}
      </div>

      {hasOverlap && (
        <div className="rounded-xl border border-[#FCA5A5] bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
          You already have a request for these dates
        </div>
      )}
      {exceedsBalance && availableBalance !== null && (
        <div className="rounded-xl border border-[#FCA5A5] bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
          Requested {effectiveDays} day{effectiveDays !== 1 ? 's' : ''} exceeds available balance of {availableBalance.toFixed(1)}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitDisabled}
        className="w-full flex items-center justify-center gap-2 py-3 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
      >
        <Plus size={16} />
        {applyLeave.isPending ? 'Submitting...' : 'Apply for Leave'}
      </button>
    </div>
  )
}

// ── Balances Tab ──────────────────────────────────────────────────────────────

function BalancesTab() {
  const now = new Date()
  const { data: balances = [], isLoading, error: balError, refetch: refetchBal } = useMyBalances(now.getFullYear())

  return (
    <div className="space-y-3">
      {isLoading ? (
        <CardSkeleton />
      ) : balError ? (
        <EmptyState variant="error" title="Failed to load balances" primaryAction={{ label: 'Retry', onClick: () => refetchBal() }} />
      ) : balances.length === 0 ? (
        <div className="text-center py-16">
          <Calendar size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">No leave balances found</p>
          <p className="text-text-tertiary text-xs mt-1">Contact HR to set up leave types for your company</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {balances.map((balance) => {
            const pct = balance.totalEntitlement > 0 ? (balance.used / balance.totalEntitlement) * 100 : 0
            return (
              <div key={balance.id} className="bg-white border border-border-default rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text-primary font-semibold text-sm">{balance.leaveTypeName}</p>
                  <span className="text-lg font-bold text-text-primary">{balance.available.toFixed(1)}</span>
                </div>
                <div className="w-full bg-surface-2 rounded-full h-1.5 mb-3">
                  <div
                    className={clsx('h-1.5 rounded-full transition-all', pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-text-secondary">
                  <span>{balance.used.toFixed(1)} used</span>
                  <span>{balance.totalEntitlement.toFixed(1)} total</span>
                </div>
                {balance.pending > 0 && (
                  <p className="text-xs text-[#B45309] mt-1.5">{balance.pending.toFixed(1)} days pending</p>
                )}
                {balance.carryForward > 0 && (
                  <p className="text-xs text-[#1D4ED8] mt-0.5">{balance.carryForward.toFixed(1)} carried forward</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { toast } = useToast()
  const [page, setPage] = useState(0)
  const { data, isLoading, error: approvalsError, refetch: refetchApprovals } = usePendingApprovals(page)
  const decide = useLeaveDecision()
  const [commenting, setCommenting] = useState<{ id: string; approved: boolean } | null>(null)
  const [comment, setComment] = useState('')

  const approvals = data?.content ?? []
  const total = data?.totalElements ?? 0

  const handleDecide = async () => {
    if (!commenting) return
    try {
      await decide.mutateAsync({ requestId: commenting.id, status: commenting.approved ? 'APPROVED' : 'REJECTED', comment: comment || undefined })
      toast(commenting.approved ? 'Leave approved' : 'Leave rejected', 'success')
      setCommenting(null)
      setComment('')
    } catch {
      toast('Failed to process decision', 'error')
    }
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <CardSkeleton />
      ) : approvalsError ? (
        <EmptyState variant="error" title="Failed to load approvals" primaryAction={{ label: 'Retry', onClick: () => refetchApprovals() }} />
      ) : approvals.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">No pending approvals</p>
        </div>
      ) : (
        approvals.map((leave) => (
          <div key={leave.id} className="bg-white border border-border-default rounded-2xl px-4 py-3">
            {/* Header row: employee identity on the left, status + inline
                actions on the right so buttons stay compact and don't grow
                with the card width (previous flex-1 layout stretched to
                ~500px each on desktop and looked broken). */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-text-primary font-medium text-sm">
                  {leave.employeeName ?? 'Employee'}{leave.employeeCode ? ` · ${leave.employeeCode}` : ''}
                </p>
                <p className="text-text-secondary text-xs mt-0.5">
                  {leave.leaveTypeName ?? 'Leave'}
                  {' · '}{format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM yyyy')}
                  {' · '}{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}
                </p>
                {leave.departmentName && <p className="text-text-tertiary text-xs mt-0.5">{leave.departmentName}</p>}
                {leave.reason && <p className="text-text-secondary text-xs mt-1 italic">&ldquo;{leave.reason}&rdquo;</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <HrStatusPill tone="warn">Pending</HrStatusPill>
                {commenting?.id !== leave.id && (
                  <Can code={P.HRMS_LEAVE_APPROVE_L1}>
                    <button
                      onClick={() => setCommenting({ id: leave.id, approved: false })}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#FEE2E2] px-2.5 py-1 text-xs font-medium text-[#B91C1C] transition-colors hover:bg-[#FECACA]"
                      aria-label="Reject"
                    >
                      <XIcon size={13} /> Reject
                    </button>
                    <button
                      onClick={() => setCommenting({ id: leave.id, approved: true })}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#DCFCE7] px-2.5 py-1 text-xs font-medium text-[#15803D] transition-colors hover:bg-[#BBF7D0]"
                      aria-label="Approve"
                    >
                      <Check size={13} /> Approve
                    </button>
                  </Can>
                )}
              </div>
            </div>

            {/* Comment box appears only when the reviewer chose Approve or
                Reject and needs to add an optional note. Kept below the
                header so the row above stays compact. */}
            {commenting?.id === leave.id && (
              <div className="mt-3 space-y-2 border-t border-border-default/40 pt-3">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={commenting.approved ? 'Approval note (optional)' : 'Rejection reason (optional)'}
                  className="w-full rounded-xl border border-border-default/60 bg-white px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setCommenting(null); setComment('') }}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDecide}
                    disabled={decide.isPending}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50',
                      commenting.approved
                        ? 'bg-[#15803D] hover:bg-[#166534]'
                        : 'bg-[#EF4444] hover:bg-[#DC2626]',
                    )}
                  >
                    {commenting.approved ? <Check size={13} /> : <XIcon size={13} />}
                    {decide.isPending ? 'Working…' : commenting.approved ? 'Confirm Approve' : 'Confirm Reject'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {total > 20 && (
        <div className="flex justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="px-3 py-1.5 text-xs border border-border-default rounded-lg text-text-secondary disabled:opacity-30 hover:text-text-primary transition-colors">Prev</button>
          <span className="text-xs text-text-secondary py-1.5">Page {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= total} className="px-3 py-1.5 text-xs border border-border-default rounded-lg text-text-secondary disabled:opacity-30 hover:text-text-primary transition-colors">Next</button>
        </div>
      )}
    </div>
  )
}

// ── Main Leave Page ───────────────────────────────────────────────────────────

const ALL_TABS: readonly Tab[] = ['my', 'apply', 'balances', 'approvals', 'types', 'holidays']

export const Leave: React.FC = () => {
  const isManager = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canManageTypes = usePermission(P.LEAVE_TYPE_WRITE)
  const canManageHolidays = usePermission(P.SETTINGS_HOLIDAYS_WRITE)

  // Support deep-linking to a specific tab via ?tab=approvals (etc). Notifications
  // + the dashboard's "Review leave requests" button rely on this — without it
  // every entry point dumped the user on 'My Leaves' regardless of the intent.
  // The URL stays in sync as the user clicks through so the back button works.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') as Tab | null
  const initialTab: Tab = requestedTab && ALL_TABS.includes(requestedTab) ? requestedTab : 'my'
  const [tab, setTab] = useState<Tab>(initialTab)

  // If the URL param changes while the page is mounted (e.g. the same-page
  // notification click), reflect it in local state without dropping other params.
  useEffect(() => {
    if (requestedTab && ALL_TABS.includes(requestedTab) && requestedTab !== tab) {
      setTab(requestedTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab])

  const switchTab = (next: Tab) => {
    setTab(next)
    // Keep any other query params intact; only rewrite ?tab=.
    const p = new URLSearchParams(searchParams)
    p.set('tab', next)
    setSearchParams(p, { replace: true })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Leaves' },
    { key: 'apply', label: 'Apply' },
    { key: 'balances', label: 'Balances' },
    ...(isManager ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    ...(canManageTypes ? [{ key: 'types' as Tab, label: 'Leave Types' }] : []),
    ...(canManageHolidays ? [{ key: 'holidays' as Tab, label: 'Holidays' }] : []),
  ]

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <HrPageHeader
        crumb="Leave Management"
        title="Leave Management"
        subtitle="Apply for leave, track balances, and manage approvals"
      />

      <div className="flex flex-wrap gap-1 bg-white border border-border-default p-1 rounded-xl w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)} className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all', tab === t.key ? 'bg-[#059669] text-white shadow' : 'text-text-secondary hover:text-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'my' && <MyLeavesTab />}
      {tab === 'apply' && <ApplyTab />}
      {tab === 'balances' && <BalancesTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'types' && <LeaveTypes />}
      {tab === 'holidays' && <HolidayCalendar />}
    </div>
  )
}
