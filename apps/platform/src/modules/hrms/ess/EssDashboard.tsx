import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardList } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useMonthlyStats } from '../api/useAttendance'
import { useMyBalances, useMyLeaves } from '../api/useLeave'

export const EssDashboard: React.FC = () => {
  const navigate = useNavigate()
  const user = useSdkStore((state) => state.user)

  // Punching is mobile-only — the web ESS dashboard no longer shows a
  // check-in/out widget. useCheckIn/useCheckOut remain in ../api/useAttendance
  // for the mobile/SDK clients.
  const { data: monthStats } = useMonthlyStats()
  const { data: balances = [] } = useMyBalances()
  const { data: myLeaves } = useMyLeaves(0)

  const recentLeaves = (myLeaves?.content ?? []).slice(0, 3)
  const pendingLeaves = (myLeaves?.content ?? []).filter((l) => l.status === 'PENDING').length

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/10 border border-indigo-500/20 rounded-2xl p-5">
        <p className="text-text-secondary text-sm">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},</p>
        <h1 className="text-2xl font-bold text-text-primary mt-0.5">{user?.firstName ?? 'Employee'} {user?.lastName ?? ''}</h1>
        <p className="text-text-secondary text-sm mt-1">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>
      {/* Monthly stats */}
      {monthStats && (
        <div className="bg-white border border-border-default rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-text-primary mb-3">This Month</h2>
          <div className="flex flex-wrap gap-5">
            {[
              { label: 'Present', value: monthStats.presentDays, color: 'text-emerald-400' },
              { label: 'Absent', value: monthStats.absentDays, color: 'text-red-400' },
              { label: 'Late', value: monthStats.lateDays, color: 'text-amber-400' },
              { label: 'On Time', value: monthStats.onTimeDays, color: 'text-blue-400' },
            ].map((s) => (
              <div key={s.label} className="text-center min-w-[48px]">
                <p className={clsx('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="text-xs text-text-secondary mt-0.5">{s.label}</p>
              </div>
            ))}
            <div className="text-center ml-auto">
              <p className="text-xl font-bold text-primary">{monthStats.attendanceScore}%</p>
              <p className="text-xs text-text-secondary mt-0.5">Score</p>
            </div>
          </div>
        </div>
      )}

      {/* Leave balances */}
      {balances.length > 0 && (
        <div className="bg-white border border-border-default rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary">Leave Balances</h2>
            <button onClick={() => navigate('/hrms/leave')} className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors">
              Apply leave <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {balances.slice(0, 6).map((b) => (
              <div key={b.id} className="bg-surface-2 rounded-xl p-3">
                <p className="text-xs text-text-secondary truncate">{b.leaveTypeName}</p>
                <p className="text-lg font-bold text-text-primary mt-0.5">{b.available.toFixed(1)}</p>
                <p className="text-xs text-text-tertiary">of {b.totalEntitlement.toFixed(1)} days</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding tasks shortcut */}
      <div className="bg-white border border-border-default rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-subtle">
              <ClipboardList size={15} className="text-accent-default" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Onboarding Tasks</p>
              <p className="text-xs text-text-secondary">View your onboarding checklist</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/hrms/onboarding/instances')}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
          >
            Open <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Recent leave requests */}
      {recentLeaves.length > 0 && (
        <div className="bg-white border border-border-default rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <h2 className="text-sm font-semibold text-text-primary">Recent Leave Requests</h2>
            {pendingLeaves > 0 && (
              <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">{pendingLeaves} pending</span>
            )}
          </div>
          {recentLeaves.map((leave) => (
            <div key={leave.id} className="flex items-center justify-between px-4 py-3 border-b border-border-default/40 last:border-0">
              <div>
                <p className="text-text-primary text-sm">{leave.leaveTypeName ?? 'Leave'}</p>
                <p className="text-text-secondary text-xs mt-0.5">
                  {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM')} · {leave.totalDays}d
                </p>
              </div>
              <span className={clsx('text-xs px-2 py-0.5 rounded-full',
                leave.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400' :
                leave.status === 'PENDING' ? 'bg-amber-500/10 text-amber-400' :
                'bg-red-500/10 text-red-400'
              )}>
                {leave.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
