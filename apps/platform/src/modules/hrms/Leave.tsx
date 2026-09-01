import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Calendar, Plus, CheckCircle, XCircle, Clock, FileText, Check, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { useVisibleTabs } from '@/shared/hooks/useVisibleTabs'
import { useRoles } from '@/shared/hooks/useRoles'
import { usePermission, Can, P } from '@unifiedtree/sdk'
import { CardSkeleton, Skeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  useMyLeaves, useMyBalances, useLeaveTypes, usePendingApprovals,
  useApplyLeave, useLeaveDecision, useCancelLeave,
  type LeaveApprovalStatus, type LeaveDuration,
} from './api/useLeave'
import { usePendingWfhApprovals, useWfhDecision } from './api/useWfh'
import { useCompanies } from './api/useOrg'
import { useHrConfig } from './api/useSettings'
import { LeaveTypes } from './leave/LeaveTypes'
import { HolidayCalendar } from './leave/HolidayCalendar'
import { HrPageHeader, HrStatusPill, HrTabs, HrTabPanel, type PillTone } from '@/shared/components/hr'

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
            <div key={leave.id} className="ut-card ut-card-sm flex items-center gap-4 px-4 py-3">
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
  const { data: hrConfig } = useHrConfig(activeCompany?.id)
  const applyLeave = useApplyLeave()

  // Weekend/off-days come from the tenant's HR configuration
  // (V1 /v1/settings/hr-configuration → weekendDays: number[] with
  // Sun=0..Sat=6). This has to match whatever payroll uses on the server
  // — a hard-coded Sat+Sun preview lied to tenants on a 6-day workweek
  // (Sunday-only) or any Middle-East schedule (Fri+Sat). Falls back to
  // the Indian statutory default of Sat+Sun ONLY when no config exists.
  const weekendDays = React.useMemo<Set<number>>(() => {
    const cfg = hrConfig?.weekendDays
    if (cfg && cfg.length > 0) return new Set(cfg)
    return new Set([0, 6])
  }, [hrConfig])

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

  // Compute effective days: half-day counts as 0.5, else count business days
  // (non-weekend) inclusive. Weekend day-numbers are pulled from the tenant's
  // HR configuration (weekendDays) instead of hard-coded Sat+Sun so a 6-day
  // workweek or a Fri+Sat schedule computes correctly. This is the frontend
  // preview only — the backend runs the authoritative calculation including
  // per-tenant holidays; a preview endpoint would be strictly better and is
  // flagged for B4 backend.
  const effectiveDays = React.useMemo(() => {
    if (!form.startDate || !effectiveEndDate) return 0
    if (isHalfDay) return 0.5
    const start = new Date(form.startDate + 'T00:00:00')
    const end = new Date(effectiveEndDate + 'T00:00:00')
    const diffMs = end.getTime() - start.getTime()
    if (isNaN(diffMs) || diffMs < 0) return 0
    // Walk each calendar day inclusive; skip tenant-configured weekend days.
    // Cap the loop at 366 iterations so a wildly out-of-order pair can never
    // spin.
    let count = 0
    const cursor = new Date(start)
    for (let i = 0; i <= 366; i++) {
      if (cursor.getTime() > end.getTime()) break
      const dow = cursor.getDay()
      if (!weekendDays.has(dow)) count += 1
      cursor.setDate(cursor.getDate() + 1)
    }
    return count
  }, [form.startDate, effectiveEndDate, isHalfDay, weekendDays])

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
    <div className="ut-card max-w-lg p-5">
      <h3 className="mb-4 text-[15px] font-semibold text-text-primary">Apply for Leave</h3>
      <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Leave Type *</label>
        {typesLoading ? (
          <Skeleton className="h-10 w-full rounded-xl" />
        ) : (
          <select
            value={form.leaveTypeId}
            onChange={(e) => setForm((p) => ({ ...p, leaveTypeId: e.target.value }))}
            className="ut-select"
          >
            <option value="">Select leave type</option>
            {leaveTypes.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.annualEntitlement} days/year)</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Start Date *</label>
          <input
            type="date"
            min={todayIso}
            value={form.startDate}
            onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
            className="ut-input"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">End Date *</label>
          <input
            type="date"
            min={form.startDate || todayIso}
            value={effectiveEndDate}
            disabled={isHalfDay}
            onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            className="ut-input"
          />
        </div>
      </div>

      <div>
        <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Duration</label>
        <select
          value={form.duration}
          onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value as typeof form.duration }))}
          className="ut-select"
        >
          <option value="FULL_DAY">Full Day</option>
          <option value="HALF_DAY_MORNING">Half Day (Morning)</option>
          <option value="HALF_DAY_AFTERNOON">Half Day (Afternoon)</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[13px] font-semibold text-text-secondary">Reason *</label>
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
      </div>

      <div className="mt-5 flex justify-end border-t border-border-default pt-4">
        <button
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#059669] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
          {applyLeave.isPending ? 'Submitting...' : 'Apply for Leave'}
        </button>
      </div>
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
              <div key={balance.id} className="ut-card ut-card-sm p-4">
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

// Approvals tab renders leave + WFH in one merged list — see Anil doc-2 issue 4
// (2026-09-01). Rows are discriminated by `kind` so decide/reject calls hit the
// right endpoint. Both queries pageinate independently but the tab is a single
// scroll; page 0 for now (paging returns if the union grows past 40 rows).

interface MergedApproval {
  kind: 'leave' | 'wfh'
  id: string
  employeeName?: string | null
  employeeCode?: string | null
  departmentName?: string | null
  startDate: string
  endDate: string
  totalDays: number
  reason: string | null
  leaveTypeName?: string | null // leave only
  createdAt?: string
}

function ApprovalsTab() {
  const { toast } = useToast()
  const [page, setPage] = useState(0)
  const { data, isLoading, error: approvalsError, refetch: refetchApprovals } = usePendingApprovals(page)
  const { data: wfhData, isLoading: wfhLoading, error: wfhError, refetch: refetchWfh } = usePendingWfhApprovals(page)
  const decide = useLeaveDecision()
  const decideWfh = useWfhDecision()
  const [commenting, setCommenting] = useState<{ id: string; kind: 'leave' | 'wfh'; approved: boolean } | null>(null)
  const [comment, setComment] = useState('')

  const leaveRows: MergedApproval[] = (data?.content ?? []).map((l) => ({
    kind: 'leave' as const,
    id: l.id,
    employeeName: l.employeeName,
    employeeCode: l.employeeCode,
    departmentName: l.departmentName,
    startDate: l.startDate,
    endDate: l.endDate,
    totalDays: l.totalDays,
    reason: l.reason,
    leaveTypeName: l.leaveTypeName ?? 'Leave',
    createdAt: l.createdAt,
  }))
  const wfhRows: MergedApproval[] = (wfhData?.content ?? []).map((w) => {
    // WFH DTO ships fromDate/toDate (LocalDate). Duration is inclusive-day count.
    const from = new Date(w.fromDate)
    const to = new Date(w.toDate)
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1)
    return {
      kind: 'wfh' as const,
      id: w.id,
      employeeName: w.employeeName,
      employeeCode: w.employeeCode,
      departmentName: w.departmentName,
      startDate: w.fromDate,
      endDate: w.toDate,
      totalDays: days,
      reason: w.reason,
      leaveTypeName: 'Work From Home',
      createdAt: w.createdAt,
    }
  })
  // Union then sort by createdAt DESC so freshest requests bubble to the top,
  // regardless of which endpoint they came from.
  const approvals: MergedApproval[] = [...leaveRows, ...wfhRows].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
  const total = (data?.totalElements ?? 0) + (wfhData?.totalElements ?? 0)

  const handleDecide = async () => {
    if (!commenting) return
    // WFH rejection MUST carry a comment — backend rejects with
    // WFH_REJECT_REASON_REQUIRED otherwise. Enforce it in the UI too.
    if (commenting.kind === 'wfh' && !commenting.approved && !comment.trim()) {
      toast('A rejection reason is required', 'error')
      return
    }
    try {
      if (commenting.kind === 'leave') {
        await decide.mutateAsync({
          requestId: commenting.id,
          status: commenting.approved ? 'APPROVED' : 'REJECTED',
          comment: comment || undefined,
        })
      } else {
        await decideWfh.mutateAsync({
          requestId: commenting.id,
          approved: commenting.approved,
          comment: comment || undefined,
        })
      }
      const kindLabel = commenting.kind === 'wfh' ? 'WFH' : 'Leave'
      toast(commenting.approved ? `${kindLabel} approved` : `${kindLabel} rejected`, 'success')
      setCommenting(null)
      setComment('')
    } catch {
      toast('Failed to process decision', 'error')
    }
  }

  const anyLoading = isLoading || wfhLoading
  const hardError = approvalsError && wfhError // both failed = show error state
  return (
    <div className="space-y-3">
      {anyLoading ? (
        <CardSkeleton />
      ) : hardError ? (
        <EmptyState variant="error" title="Failed to load approvals" primaryAction={{ label: 'Retry', onClick: () => { refetchApprovals(); refetchWfh() } }} />
      ) : approvals.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">No pending approvals</p>
        </div>
      ) : (
        approvals.map((row) => (
          <div key={`${row.kind}-${row.id}`} className="ut-card ut-card-sm px-4 py-3">
            {/* Header row: employee identity on the left, status + inline
                actions on the right so buttons stay compact and don't grow
                with the card width. Kind pill (Leave / WFH) sits next to the
                pending pill so approvers can tell the two apart at a glance. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-text-primary font-medium text-sm">
                  {row.employeeName ?? 'Employee'}{row.employeeCode ? ` · ${row.employeeCode}` : ''}
                </p>
                <p className="text-text-secondary text-xs mt-0.5">
                  {row.leaveTypeName ?? 'Leave'}
                  {' · '}{format(new Date(row.startDate), 'd MMM')} – {format(new Date(row.endDate), 'd MMM yyyy')}
                  {' · '}{row.totalDays} day{row.totalDays !== 1 ? 's' : ''}
                </p>
                {row.departmentName && <p className="text-text-tertiary text-xs mt-0.5">{row.departmentName}</p>}
                {row.reason && <p className="text-text-secondary text-xs mt-1 italic">&ldquo;{row.reason}&rdquo;</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <HrStatusPill tone={row.kind === 'wfh' ? 'purple' : 'blue'}>
                  {row.kind === 'wfh' ? 'WFH' : 'Leave'}
                </HrStatusPill>
                <HrStatusPill tone="warn">Pending</HrStatusPill>
                {commenting?.id !== row.id && (
                  <Can code={P.HRMS_LEAVE_APPROVE_L1}>
                    <button
                      onClick={() => setCommenting({ id: row.id, kind: row.kind, approved: false })}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#FEE2E2] px-2.5 py-1 text-xs font-medium text-[#B91C1C] transition-colors hover:bg-[#FECACA]"
                      aria-label="Reject"
                    >
                      <XIcon size={13} /> Reject
                    </button>
                    <button
                      onClick={() => setCommenting({ id: row.id, kind: row.kind, approved: true })}
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
            {commenting?.id === row.id && (
              <div className="mt-3 space-y-2 border-t border-border-default/40 pt-3">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={
                    commenting.approved
                      ? 'Approval note (optional)'
                      : commenting.kind === 'wfh'
                        ? 'Rejection reason (required)'
                        : 'Rejection reason (optional)'
                  }
                  className="ut-input ut-input-sm"
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
                    disabled={decide.isPending || decideWfh.isPending}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50',
                      commenting.approved
                        ? 'bg-[#15803D] hover:bg-[#166534]'
                        : 'bg-[#EF4444] hover:bg-[#DC2626]',
                    )}
                  >
                    {commenting.approved ? <Check size={13} /> : <XIcon size={13} />}
                    {(decide.isPending || decideWfh.isPending) ? 'Working…' : commenting.approved ? 'Confirm Approve' : 'Confirm Reject'}
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

// Single source of truth for every leave tab — labels, keys, and the
// permission code that gates each. `useVisibleTabs` filters this list per
// user against the SDK auth store. Order here is the tab order shown in
// the UI, so if the URL asks for a tab the user cannot see, we silently
// fall back to visibleTabs[0] (the leftmost tab they can see).
//
// Holidays is intentionally NOT gated at the tab level — every role
// (EMPLOYEE + MANAGER included) needs to view the calendar. Write
// actions (Add / Delete) are gated inside HolidayCalendar via canEdit
// so read-only viewers see the list without buttons.
//
// Leave Types is likewise NOT gated at the tab level per client rule:
// "employees can DISPLAY Leave Types and Holidays but not edit them; only
// HR/ADMIN can edit." LeaveTypes.tsx wraps every add/edit/delete/seed
// affordance in <Can code={P.LEAVE_TYPE_WRITE}> so read-only viewers see
// the list without the mutation buttons. Gating the tab itself hid the
// screen from the very audience the client asked to see it.
const ALL_TABS = [
  { key: 'my',        label: 'My Leaves' },
  { key: 'apply',     label: 'Apply' },
  { key: 'balances',  label: 'Balances' },
  { key: 'approvals', label: 'Approvals',   requires: P.HRMS_LEAVE_APPROVE_L1 },
  { key: 'types',     label: 'Leave Types' },
  { key: 'holidays',  label: 'Holidays' },
] as const

type TabKey = typeof ALL_TABS[number]['key']

export const Leave: React.FC = () => {
  const { isAdmin } = useRoles()
  // Client rule: ADMIN never applies for their own leave, so the personal
  // tabs (My Leaves / Apply / Balances) are hidden for the admin bucket.
  // Non-admin roles keep the full tab set; edit affordances on Leave Types
  // and Holidays stay permission-gated inside the child components.
  const roleFilteredTabs = React.useMemo(
    () => ALL_TABS.filter((t) => !(isAdmin && (t.key === 'my' || t.key === 'apply' || t.key === 'balances'))),
    [isAdmin],
  )
  const visibleTabs = useVisibleTabs([...roleFilteredTabs])
  const canEditHolidays = usePermission(P.SETTINGS_HOLIDAYS_WRITE)

  // Support deep-linking to a specific tab via ?tab=approvals (etc). Notifications
  // + the dashboard's "Review leave requests" button rely on this — without it
  // every entry point dumped the user on 'My Leaves' regardless of the intent.
  // The URL stays in sync as the user clicks through so the back button works.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') as TabKey | null
  const isVisible = (k: string | null | undefined): k is TabKey =>
    !!k && visibleTabs.some((t) => t.key === k)
  // Fallback to the first tab the user can actually see. visibleTabs is
  // never empty in practice — My/Apply/Balances/Holidays have no gate
  // — but we belt-and-brace to 'my' so a config bug can't crash the page.
  const fallbackTab: TabKey = (visibleTabs[0]?.key ?? 'my') as TabKey
  const initialTab: TabKey = isVisible(requestedTab) ? requestedTab : fallbackTab
  const [tab, setTab] = useState<TabKey>(initialTab)

  // If the URL param changes while the page is mounted (e.g. the same-page
  // notification click), reflect it in local state without dropping other params.
  useEffect(() => {
    if (isVisible(requestedTab) && requestedTab !== tab) {
      setTab(requestedTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab])

  // Route-level guard: if a deep link asks for a tab this user is not
  // allowed to see (e.g. an approvals link forwarded to an employee),
  // rewrite the URL to the first visible tab instead of crashing or
  // showing a blank body. `replace: true` keeps the browser back button
  // pointing at wherever they came from.
  useEffect(() => {
    if (requestedTab && !isVisible(requestedTab)) {
      const p = new URLSearchParams(searchParams)
      p.set('tab', fallbackTab)
      setSearchParams(p, { replace: true })
      setTab(fallbackTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab, visibleTabs.length])

  const switchTab = (next: TabKey) => {
    setTab(next)
    // Keep any other query params intact; only rewrite ?tab=.
    const p = new URLSearchParams(searchParams)
    p.set('tab', next)
    setSearchParams(p, { replace: true })
  }

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <HrPageHeader
        crumb="Leave Management"
        title="Leave Management"
        subtitle="Apply for leave, track balances, and manage approvals"
      />

      <HrTabs
        tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
        active={tab}
        onChange={(k) => switchTab(k as TabKey)}
      />

      {tab === 'my' && <HrTabPanel tabKey="my"><MyLeavesTab /></HrTabPanel>}
      {tab === 'apply' && <HrTabPanel tabKey="apply"><ApplyTab /></HrTabPanel>}
      {tab === 'balances' && <HrTabPanel tabKey="balances"><BalancesTab /></HrTabPanel>}
      {tab === 'approvals' && <HrTabPanel tabKey="approvals"><ApprovalsTab /></HrTabPanel>}
      {tab === 'types' && <HrTabPanel tabKey="types"><LeaveTypes /></HrTabPanel>}
      {tab === 'holidays' && <HrTabPanel tabKey="holidays"><HolidayCalendar canEdit={canEditHolidays} /></HrTabPanel>}
    </div>
  )
}
