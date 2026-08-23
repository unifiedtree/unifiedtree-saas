import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardList, CheckCircle, Clock, Home, Repeat } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { HrStatCard, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { useMonthlyStats } from '../api/useAttendance'
import { useMyBalances, useMyLeaves } from '../api/useLeave'

const LEAVE_TONE: Record<string, PillTone> = {
  APPROVED: 'ok', PENDING: 'warn', REJECTED: 'red', CANCELLED: 'gray', PENDING_L2: 'purple',
}

export const EssDashboard: React.FC = () => {
  const navigate = useNavigate()
  const user = useSdkStore((state) => state.user)

  // Punching is mobile-only — the web ESS dashboard no longer shows a check-in/out
  // widget. useCheckIn/useCheckOut remain in ../api/useAttendance for mobile clients.
  const {
    data: monthStats,
    isLoading: monthStatsLoading,
    error: monthStatsError,
    refetch: refetchMonthStats,
  } = useMonthlyStats()
  const {
    data: balances = [],
    isLoading: balancesLoading,
    error: balancesError,
    refetch: refetchBalances,
  } = useMyBalances()
  const { data: myLeaves } = useMyLeaves(0)

  const recentLeaves = (myLeaves?.content ?? []).slice(0, 3)
  const pendingLeaves = (myLeaves?.content ?? []).filter((l) => l.status === 'PENDING').length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      {/* Greeting */}
      <div className="rounded-2xl border border-[#6EE7B7] bg-[#ECFDF5] p-5">
        <p className="text-sm text-[#064E3B]">Good {greeting},</p>
        <h1 className="mt-0.5 text-2xl font-bold text-text-primary">{user?.firstName ?? 'Employee'} {user?.lastName ?? ''}</h1>
        <p className="mt-1 text-sm text-text-secondary">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* Monthly stats — explicit loading + error states so a network hiccup
          doesn't leave the employee looking at a blank card wondering whether
          the day counted or the page broke. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">This Month</h2>
        {monthStatsLoading ? (
          <CardSkeleton />
        ) : monthStatsError ? (
          <EmptyState
            variant="error"
            title="Couldn't load attendance stats"
            description="Check your connection and retry."
            primaryAction={{ label: 'Retry', onClick: () => refetchMonthStats() }}
          />
        ) : monthStats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={monthStats.presentDays}            label="Present" />
            <HrStatCard icon={<Clock size={16} />}       color="red"    value={monthStats.absentDays}             label="Absent" />
            <HrStatCard icon={<Clock size={16} />}       color="orange" value={monthStats.lateDays}               label="Late" />
            <HrStatCard icon={<CheckCircle size={16} />} color="blue"   value={monthStats.onTimeDays}             label="On Time" />
            <HrStatCard icon={<CheckCircle size={16} />} color="teal"   value={`${monthStats.attendanceScore}%`}  label="Score" />
          </div>
        ) : null}
      </div>

      {/* Leave balances — same loading/error treatment as the stats block. */}
      <div className="ut-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Leave Balances</h2>
          <button onClick={() => navigate('/hrms/leave')} className="flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#064E3B]">
            Apply leave <ArrowRight size={12} />
          </button>
        </div>
        {balancesLoading ? (
          <CardSkeleton />
        ) : balancesError ? (
          <EmptyState
            variant="error"
            title="Couldn't load leave balances"
            primaryAction={{ label: 'Retry', onClick: () => refetchBalances() }}
          />
        ) : balances.length === 0 ? (
          <p className="text-xs text-text-tertiary">
            No leave types have been assigned to you yet. Contact HR to set up your balances.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {balances.slice(0, 6).map((b) => (
              <div key={b.id} className="rounded-xl bg-bg-base p-3">
                <p className="truncate text-xs text-text-secondary">{b.leaveTypeName}</p>
                <p className="mt-0.5 text-lg font-bold text-text-primary">{b.available.toFixed(1)}</p>
                <p className="text-xs text-text-tertiary">of {b.totalEntitlement.toFixed(1)} days</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding tasks shortcut */}
      <div className="ut-card ut-card-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5]">
              <ClipboardList size={15} className="text-[#059669]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Onboarding Tasks</p>
              <p className="text-xs text-text-secondary">View your onboarding checklist</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/hrms/onboarding/instances')}
            className="flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#064E3B]"
          >
            Open <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Employee self-service shortcuts — mirror the mobile app's "Apply WFH"
          and "Shift Change" so desk employees can raise these from a laptop
          without a phone. Kept as two adjacent cards to preserve the existing
          spacing rhythm; teammate can restyle into a single row/grid later. */}
      <div className="ut-card ut-card-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5]">
              <Home size={15} className="text-[#059669]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Work From Home</p>
              <p className="text-xs text-text-secondary">Request approval to work from home</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/me/wfh')}
            className="flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#064E3B]"
          >
            Request WFH <ArrowRight size={12} />
          </button>
        </div>
      </div>

      <div className="ut-card ut-card-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5]">
              <Repeat size={15} className="text-[#059669]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Shift Change</p>
              <p className="text-xs text-text-secondary">Ask HR to move you to a different shift</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/me/shift-change')}
            className="flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#064E3B]"
          >
            Request Shift Change <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Recent leave requests */}
      {recentLeaves.length > 0 && (
        <div className="ut-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Recent Leave Requests</h2>
            {pendingLeaves > 0 && <HrStatusPill tone="warn">{pendingLeaves} pending</HrStatusPill>}
          </div>
          {recentLeaves.map((leave) => (
            <div key={leave.id} className="flex items-center justify-between border-b border-border-default/40 px-4 py-3 last:border-0">
              <div>
                <p className="text-sm text-text-primary">{leave.leaveTypeName ?? 'Leave'}</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM')} · {leave.totalDays}d
                </p>
              </div>
              <HrStatusPill tone={LEAVE_TONE[leave.status] ?? 'gray'}>{leave.status}</HrStatusPill>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
