import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Clock, Calendar, ArrowRight, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useTeamDashboard } from '../api/useAttendance'
import { usePendingApprovals } from '../api/useLeave'

const today = format(new Date(), 'yyyy-MM-dd')

const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const s = status?.toUpperCase()
  if (s === 'PRESENT' || s === 'CHECKED_IN')
    return <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
  if (s === 'ABSENT')
    return <span className="inline-flex h-2 w-2 rounded-full bg-rose-500" />
  if (s === 'LATE')
    return <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
  return <span className="inline-flex h-2 w-2 rounded-full bg-slate-300" />
}

export const TeamDashboard: React.FC = () => {
  const navigate = useNavigate()
  const user = useSdkStore(s => s.user)

  const { data: teamData, isLoading: teamLoading } = useTeamDashboard(today)
  const { data: approvals, isLoading: approvalsLoading } = usePendingApprovals(0)

  const counts = teamData?.counts
  const staffStatuses = teamData?.staffStatuses ?? []
  const pendingLeaves = approvals?.content ?? []

  const statCards = [
    {
      label: 'Present today',
      value: teamLoading ? '—' : (counts?.present ?? 0),
      icon: <CheckCircle size={18} className="text-emerald-500" />,
      bg: 'bg-emerald-50',
    },
    {
      label: 'Absent today',
      value: teamLoading ? '—' : (counts?.absent ?? 0),
      icon: <XCircle size={18} className="text-rose-500" />,
      bg: 'bg-rose-50',
    },
    {
      label: 'On leave',
      value: teamLoading ? '—' : (counts?.onLeave ?? 0),
      icon: <Calendar size={18} className="text-blue-500" />,
      bg: 'bg-blue-50',
    },
    {
      label: 'Pending approvals',
      value: approvalsLoading ? '—' : pendingLeaves.length,
      icon: <AlertCircle size={18} className="text-amber-500" />,
      bg: 'bg-amber-50',
    },
  ]

  return (
    <div className="space-y-6 p-6">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-[#0F6E56]/10 to-emerald-50 border border-[#0F6E56]/15 rounded-2xl p-5">
        <p className="text-slate-500 text-sm">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
          {user?.firstName ?? 'Manager'} — your team today
        </h1>
        <p className="text-slate-500 text-sm mt-1">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((c) => (
          <div key={c.label} className={clsx('rounded-2xl border border-slate-200 p-4', c.bg)}>
            <div className="mb-2">{c.icon}</div>
            <p className="text-2xl font-bold text-slate-900">{String(c.value)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Team attendance status */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800">Team attendance — {format(new Date(), 'd MMM')}</h2>
          </div>
          <button
            onClick={() => navigate('/hrms/attendance')}
            className="flex items-center gap-1 text-xs text-[#0F6E56] hover:text-[#0A5240] transition-colors"
          >
            Full view <ArrowRight size={12} />
          </button>
        </div>

        {teamLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-400">Loading…</div>
        ) : staffStatuses.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-400">
            No team data available for today
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {staffStatuses.slice(0, 8).map((s) => (
              <div key={s.employeeId} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                  {s.fullName?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{s.fullName}</p>
                  <p className="text-xs text-slate-400 truncate">{s.jobTitle ?? s.departmentName ?? ''}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusDot status={s.status} />
                  <span className="text-xs text-slate-500 capitalize">{s.status?.toLowerCase().replace('_', ' ')}</span>
                  {s.checkInAt && (
                    <span className="text-xs text-slate-400 ml-1">
                      {format(new Date(s.checkInAt), 'h:mm a')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending leave approvals */}
      {pendingLeaves.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-800">Pending leave approvals</h2>
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                {pendingLeaves.length}
              </span>
            </div>
            <button
              onClick={() => navigate('/hrms/leave')}
              className="flex items-center gap-1 text-xs text-[#0F6E56] hover:text-[#0A5240] transition-colors"
            >
              Approve <ArrowRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {pendingLeaves.slice(0, 5).map((leave) => (
              <div key={leave.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {leave.leaveTypeName ?? 'Leave request'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM')}
                    {' · '}{leave.totalDays}d
                  </p>
                </div>
                <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-200 shrink-0">
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
