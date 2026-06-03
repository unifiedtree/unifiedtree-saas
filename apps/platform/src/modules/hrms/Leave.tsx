import React, { useState } from 'react'
import { Calendar, Plus, CheckCircle, XCircle, Clock, FileText } from 'lucide-react'
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

type Tab = 'my' | 'apply' | 'balances' | 'approvals' | 'types' | 'holidays'

const STATUS_STYLE: Record<LeaveApprovalStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING: { label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Clock },
  APPROVED: { label: 'Approved', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle },
  REJECTED: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  CANCELLED: { label: 'Cancelled', color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40', icon: XCircle },
  ESCALATED: { label: 'Escalated', color: 'text-purple-400', bg: 'bg-purple-500/10', icon: Clock },
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
          <FileText size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-[#64748B] text-sm">No leave requests yet</p>
          <p className="text-slate-600 text-xs mt-1">Use the Apply tab to request leave</p>
        </div>
      ) : (
        leaves.map((leave) => {
          const sc = STATUS_STYLE[leave.status] ?? STATUS_STYLE['PENDING']
          return (
            <div key={leave.id} className="bg-white border border-[#E2E8F0] rounded-2xl px-4 py-3 flex items-center gap-4">
              <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', sc.bg)}>
                <sc.icon size={16} className={sc.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[#0F172A] font-medium text-sm">{leave.leaveTypeName ?? 'Leave'}</p>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                </div>
                <p className="text-[#64748B] text-xs mt-0.5">
                  {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM yyyy')}
                  {' · '}{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}
                </p>
                {leave.reason && <p className="text-slate-600 text-xs truncate mt-0.5">"{leave.reason}"</p>}
              </div>
              {leave.status === 'PENDING' && (
                <button
                  onClick={() => handleCancel(leave.id)}
                  disabled={cancelLeave.isPending}
                  className="text-xs text-[#64748B] hover:text-red-400 transition-colors disabled:opacity-50 whitespace-nowrap"
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
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="px-3 py-1.5 text-xs border border-[#E2E8F0] rounded-lg text-[#64748B] disabled:opacity-30 hover:text-[#0F172A] transition-colors">Prev</button>
          <span className="text-xs text-[#64748B] py-1.5">Page {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= total} className="px-3 py-1.5 text-xs border border-[#E2E8F0] rounded-lg text-[#64748B] disabled:opacity-30 hover:text-[#0F172A] transition-colors">Next</button>
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
  const applyLeave = useApplyLeave()

  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    duration: 'FULL_DAY' as LeaveDuration,
    reason: '',
  })

  const handleSubmit = async () => {
    if (!form.leaveTypeId || !form.startDate || !form.endDate) {
      toast('Leave type and dates are required', 'error')
      return
    }
    if (form.endDate < form.startDate) {
      toast('End date must be after start date', 'error')
      return
    }
    try {
      await applyLeave.mutateAsync({ ...form, companyId: activeCompany?.id })
      toast('Leave request submitted', 'success')
      setForm({ leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '' })
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to apply for leave', 'error')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#64748B] mb-1.5">Leave Type *</label>
        {typesLoading ? (
          <Skeleton className="h-10 w-full rounded-xl" />
        ) : (
          <select
            value={form.leaveTypeId}
            onChange={(e) => setForm((p) => ({ ...p, leaveTypeId: e.target.value }))}
            className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
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
          <label className="block text-xs font-medium text-[#64748B] mb-1.5">Start Date *</label>
          <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5">End Date *</label>
          <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[#64748B] mb-1.5">Duration</label>
        <select
          value={form.duration}
          onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value as typeof form.duration }))}
          className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary"
        >
          <option value="FULL_DAY">Full Day</option>
          <option value="HALF_DAY_MORNING">Half Day (Morning)</option>
          <option value="HALF_DAY_AFTERNOON">Half Day (Afternoon)</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-[#64748B] mb-1.5">Reason</label>
        <textarea
          value={form.reason}
          onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
          rows={3}
          placeholder="Reason for leave (optional)"
          className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary resize-none"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={applyLeave.isPending}
        className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
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
          <Calendar size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-[#64748B] text-sm">No leave balances found</p>
          <p className="text-slate-600 text-xs mt-1">Contact HR to set up leave types for your company</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {balances.map((balance) => {
            const pct = balance.totalEntitlement > 0 ? (balance.used / balance.totalEntitlement) * 100 : 0
            return (
              <div key={balance.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[#0F172A] font-semibold text-sm">{balance.leaveTypeName}</p>
                  <span className="text-lg font-bold text-[#0F172A]">{balance.available.toFixed(1)}</span>
                </div>
                <div className="w-full bg-white rounded-full h-1.5 mb-3">
                  <div
                    className={clsx('h-1.5 rounded-full transition-all', pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-[#64748B]">
                  <span>{balance.used.toFixed(1)} used</span>
                  <span>{balance.totalEntitlement.toFixed(1)} total</span>
                </div>
                {balance.pending > 0 && (
                  <p className="text-xs text-amber-400 mt-1.5">{balance.pending.toFixed(1)} days pending</p>
                )}
                {balance.carryForward > 0 && (
                  <p className="text-xs text-blue-400 mt-0.5">{balance.carryForward.toFixed(1)} carried forward</p>
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
          <CheckCircle size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-[#64748B] text-sm">No pending approvals</p>
        </div>
      ) : (
        approvals.map((leave) => (
          <div key={leave.id} className="bg-white border border-[#E2E8F0] rounded-2xl px-4 py-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[#0F172A] font-medium text-sm">{leave.leaveTypeName ?? 'Leave'}</p>
                <p className="text-[#64748B] text-xs mt-0.5">
                  {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM yyyy')}
                  {' · '}{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}
                </p>
                {leave.reason && <p className="text-[#64748B] text-xs mt-0.5 italic">"{leave.reason}"</p>}
              </div>
              <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full flex-shrink-0">Pending</span>
            </div>
            {commenting?.id === leave.id ? (
              <div className="space-y-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Comment (optional)"
                  className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button onClick={() => setCommenting(null)} className="flex-1 py-2 border border-[#E2E8F0] text-[#64748B] text-xs rounded-xl hover:text-[#0F172A] transition-colors">Cancel</button>
                  <button onClick={handleDecide} disabled={decide.isPending} className={clsx('flex-1 py-2 text-xs rounded-xl font-medium transition-colors disabled:opacity-50', commenting.approved ? 'bg-emerald-600 hover:bg-emerald-500 text-[#0F172A]' : 'bg-red-600 hover:bg-red-500 text-[#0F172A]')}>
                    {decide.isPending ? '...' : commenting.approved ? 'Confirm Approve' : 'Confirm Reject'}
                  </button>
                </div>
              </div>
            ) : (
              <Can code={P.HRMS_LEAVE_APPROVE_L1}>
                <div className="flex gap-2">
                  <button onClick={() => setCommenting({ id: leave.id, approved: true })} className="flex-1 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs rounded-lg transition-colors font-medium">Approve</button>
                  <button onClick={() => setCommenting({ id: leave.id, approved: false })} className="flex-1 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs rounded-lg transition-colors font-medium">Reject</button>
                </div>
              </Can>
            )}
          </div>
        ))
      )}

      {total > 20 && (
        <div className="flex justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="px-3 py-1.5 text-xs border border-[#E2E8F0] rounded-lg text-[#64748B] disabled:opacity-30 hover:text-[#0F172A] transition-colors">Prev</button>
          <span className="text-xs text-[#64748B] py-1.5">Page {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= total} className="px-3 py-1.5 text-xs border border-[#E2E8F0] rounded-lg text-[#64748B] disabled:opacity-30 hover:text-[#0F172A] transition-colors">Next</button>
        </div>
      )}
    </div>
  )
}

// ── Main Leave Page ───────────────────────────────────────────────────────────

export const Leave: React.FC = () => {
  const isManager = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canManageTypes = usePermission(P.LEAVE_TYPE_WRITE)
  const canManageHolidays = usePermission(P.SETTINGS_HOLIDAYS_WRITE)
  const [tab, setTab] = useState<Tab>('my')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Leaves' },
    { key: 'apply', label: 'Apply' },
    { key: 'balances', label: 'Balances' },
    ...(isManager ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    ...(canManageTypes ? [{ key: 'types' as Tab, label: 'Leave Types' }] : []),
    ...(canManageHolidays ? [{ key: 'holidays' as Tab, label: 'Holidays' }] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Leave Management</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Apply for leave, track balances, and manage approvals</p>
      </div>

      <div className="flex flex-wrap gap-1 bg-white p-1 rounded-xl w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all', tab === t.key ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary')}>
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
