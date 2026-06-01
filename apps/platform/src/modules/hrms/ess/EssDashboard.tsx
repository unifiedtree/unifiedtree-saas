import React from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, LogIn, LogOut, ArrowRight, ClipboardList } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useTodayAttendance, useMonthlyStats, useCheckIn, useCheckOut } from '../api/useAttendance'
import { useMyBalances, useMyLeaves } from '../api/useLeave'

export const EssDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const user = useSdkStore((state) => state.user)

  const { data: today } = useTodayAttendance()
  const { data: monthStats } = useMonthlyStats()
  const { data: balances = [] } = useMyBalances()
  const { data: myLeaves } = useMyLeaves(0)

  const checkIn = useCheckIn()
  const checkOut = useCheckOut()

  const isCheckedIn = !!today?.checkInTime && !today?.checkOutTime
  const isCheckedOut = !!today?.checkOutTime
  const isPending = checkIn.isPending || checkOut.isPending

  const recentLeaves = (myLeaves?.content ?? []).slice(0, 3)
  const pendingLeaves = (myLeaves?.content ?? []).filter((l) => l.status === 'PENDING').length

  const handlePunch = async () => {
    try {
      if (isCheckedIn) {
        await checkOut.mutateAsync({})
        toast('Checked out', 'success')
      } else if (!isCheckedOut) {
        await checkIn.mutateAsync({ checkInMethod: 'MANUAL' })
        toast('Checked in', 'success')
      }
    } catch {
      toast('Failed to punch attendance', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/10 border border-indigo-500/20 rounded-2xl p-5">
        <p className="text-[#64748B] text-sm">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},</p>
        <h1 className="text-2xl font-bold text-[#0F172A] mt-0.5">{user?.firstName ?? 'Employee'} {user?.lastName ?? ''}</h1>
        <p className="text-[#64748B] text-sm mt-1">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* Punch card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#334155]">Today's Attendance</h2>
          <button onClick={() => navigate('/hrms/attendance')} className="flex items-center gap-1 text-xs text-[#0F6E56] hover:text-[#0F6E56] transition-colors">
            View history <ArrowRight size={12} />
          </button>
        </div>
        <div className="flex items-center gap-6 mb-4">
          <div>
            <p className="text-xs text-[#64748B]">Check In</p>
            <p className="text-[#0F172A] font-semibold">{today?.checkInTime ? format(new Date(today.checkInTime), 'h:mm a') : '—'}</p>
          </div>
          <div className="h-6 w-px bg-[#F1F5F9]" />
          <div>
            <p className="text-xs text-[#64748B]">Check Out</p>
            <p className="text-[#0F172A] font-semibold">{today?.checkOutTime ? format(new Date(today.checkOutTime), 'h:mm a') : '—'}</p>
          </div>
          {today?.workHours != null && (
            <>
              <div className="h-6 w-px bg-[#F1F5F9]" />
              <div>
                <p className="text-xs text-[#64748B]">Hours</p>
                <p className="text-[#0F172A] font-semibold">{today.workHours.toFixed(1)}h</p>
              </div>
            </>
          )}
        </div>
        {isCheckedOut ? (
          <div className="flex items-center gap-2 bg-emerald-500/10 rounded-xl px-4 py-2.5">
            <CheckCircle size={14} className="text-emerald-400" />
            <span className="text-sm text-emerald-400">Attendance marked</span>
          </div>
        ) : (
          <button
            onClick={handlePunch}
            disabled={isPending}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50',
              isCheckedIn ? 'bg-amber-500 hover:bg-amber-400 text-[#0F172A]' : 'bg-indigo-600 hover:bg-indigo-500 text-[#0F172A]'
            )}
          >
            {isPending ? 'Processing...' : isCheckedIn ? <><LogOut size={15} /> Check Out</> : <><LogIn size={15} /> Check In</>}
          </button>
        )}
      </div>

      {/* Monthly stats */}
      {monthStats && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-[#334155] mb-3">This Month</h2>
          <div className="flex flex-wrap gap-5">
            {[
              { label: 'Present', value: monthStats.presentDays, color: 'text-emerald-400' },
              { label: 'Absent', value: monthStats.absentDays, color: 'text-red-400' },
              { label: 'Late', value: monthStats.lateDays, color: 'text-amber-400' },
              { label: 'On Time', value: monthStats.onTimeDays, color: 'text-blue-400' },
            ].map((s) => (
              <div key={s.label} className="text-center min-w-[48px]">
                <p className={clsx('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="text-xs text-[#64748B] mt-0.5">{s.label}</p>
              </div>
            ))}
            <div className="text-center ml-auto">
              <p className="text-xl font-bold text-[#0F6E56]">{monthStats.attendanceScore}%</p>
              <p className="text-xs text-[#64748B] mt-0.5">Score</p>
            </div>
          </div>
        </div>
      )}

      {/* Leave balances */}
      {balances.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#334155]">Leave Balances</h2>
            <button onClick={() => navigate('/hrms/leave')} className="flex items-center gap-1 text-xs text-[#0F6E56] hover:text-[#0F6E56] transition-colors">
              Apply leave <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {balances.slice(0, 6).map((b) => (
              <div key={b.id} className="bg-white/50 rounded-xl p-3">
                <p className="text-xs text-[#64748B] truncate">{b.leaveTypeName}</p>
                <p className="text-lg font-bold text-[#0F172A] mt-0.5">{b.available.toFixed(1)}</p>
                <p className="text-xs text-slate-600">of {b.totalEntitlement.toFixed(1)} days</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding tasks shortcut */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-subtle">
              <ClipboardList size={15} className="text-accent-default" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#334155]">Onboarding Tasks</p>
              <p className="text-xs text-[#64748B]">View your onboarding checklist</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/hrms/onboarding/instances')}
            className="flex items-center gap-1 text-xs text-[#0F6E56] hover:text-[#0F6E56] transition-colors"
          >
            Open <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Recent leave requests */}
      {recentLeaves.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
            <h2 className="text-sm font-semibold text-[#334155]">Recent Leave Requests</h2>
            {pendingLeaves > 0 && (
              <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">{pendingLeaves} pending</span>
            )}
          </div>
          {recentLeaves.map((leave) => (
            <div key={leave.id} className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]/40 last:border-0">
              <div>
                <p className="text-[#0F172A] text-sm">{leave.leaveTypeName ?? 'Leave'}</p>
                <p className="text-[#64748B] text-xs mt-0.5">
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
