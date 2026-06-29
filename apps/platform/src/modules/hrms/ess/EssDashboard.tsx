import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardList, CheckCircle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { HrStatCard, HrStatusPill, type PillTone } from '@/shared/components/hr'
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
  const { data: monthStats } = useMonthlyStats()
  const { data: balances = [] } = useMyBalances()
  const { data: myLeaves } = useMyLeaves(0)

  const recentLeaves = (myLeaves?.content ?? []).slice(0, 3)
  const pendingLeaves = (myLeaves?.content ?? []).filter((l) => l.status === 'PENDING').length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      {/* Greeting */}
      <div className="rounded-2xl border border-[#FFD68A] bg-[#FFF4E1] p-5">
        <p className="text-sm text-[#9A5600]">Good {greeting},</p>
        <h1 className="mt-0.5 text-2xl font-bold text-text-primary">{user?.firstName ?? 'Employee'} {user?.lastName ?? ''}</h1>
        <p className="mt-1 text-sm text-text-secondary">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* Monthly stats */}
      {monthStats && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-text-primary">This Month</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={monthStats.presentDays}            label="Present" />
            <HrStatCard icon={<Clock size={16} />}       color="red"    value={monthStats.absentDays}             label="Absent" />
            <HrStatCard icon={<Clock size={16} />}       color="orange" value={monthStats.lateDays}               label="Late" />
            <HrStatCard icon={<CheckCircle size={16} />} color="blue"   value={monthStats.onTimeDays}             label="On Time" />
            <HrStatCard icon={<CheckCircle size={16} />} color="teal"   value={`${monthStats.attendanceScore}%`}  label="Score" />
          </div>
        </div>
      )}

      {/* Leave balances */}
      {balances.length > 0 && (
        <div className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Leave Balances</h2>
            <button onClick={() => navigate('/hrms/leave')} className="flex items-center gap-1 text-xs font-semibold text-[#C16E00] hover:text-[#9A5600]">
              Apply leave <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {balances.slice(0, 6).map((b) => (
              <div key={b.id} className="rounded-xl bg-bg-base p-3">
                <p className="truncate text-xs text-text-secondary">{b.leaveTypeName}</p>
                <p className="mt-0.5 text-lg font-bold text-text-primary">{b.available.toFixed(1)}</p>
                <p className="text-xs text-text-tertiary">of {b.totalEntitlement.toFixed(1)} days</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding tasks shortcut */}
      <div className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF4E1]">
              <ClipboardList size={15} className="text-[#FF9D00]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Onboarding Tasks</p>
              <p className="text-xs text-text-secondary">View your onboarding checklist</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/hrms/onboarding/instances')}
            className="flex items-center gap-1 text-xs font-semibold text-[#C16E00] hover:text-[#9A5600]"
          >
            Open <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Recent leave requests */}
      {recentLeaves.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border-default bg-white shadow-sm">
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
