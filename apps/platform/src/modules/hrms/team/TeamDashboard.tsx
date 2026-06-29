import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Clock, Calendar, ArrowRight, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useTeamDashboard } from '../api/useAttendance'
import { usePendingApprovals } from '../api/useLeave'
import {
  HrPageHeader,
  HrStatCard,
  HrStatusPill,
  HrButton,
  HrAvatar,
  type PillTone,
} from '@/shared/components/hr'

const today = format(new Date(), 'yyyy-MM-dd')

function statusPill(status: string): { tone: PillTone; label: string } {
  const s = status?.toUpperCase()
  const label = status?.toLowerCase().replace('_', ' ') ?? '—'
  if (s === 'PRESENT' || s === 'CHECKED_IN') return { tone: 'ok', label }
  if (s === 'ABSENT') return { tone: 'red', label }
  if (s === 'LATE') return { tone: 'late', label }
  return { tone: 'gray', label }
}

export const TeamDashboard: React.FC = () => {
  const navigate = useNavigate()
  const user = useSdkStore(s => s.user)

  const { data: teamData, isLoading: teamLoading } = useTeamDashboard(today)
  const { data: approvals, isLoading: approvalsLoading } = usePendingApprovals(0)

  const counts = teamData?.counts
  const staffStatuses = teamData?.staffStatuses ?? []
  const pendingLeaves = approvals?.content ?? []

  const greeting =
    new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      {/* Greeting */}
      <HrPageHeader
        crumb="Attendance & Time"
        title={`Good ${greeting}, ${user?.firstName ?? 'Manager'} — your team today`}
        subtitle={format(new Date(), 'EEEE, d MMMM yyyy')}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HrStatCard
          color="green"
          icon={<CheckCircle size={18} />}
          value={counts?.present ?? 0}
          label="Present today"
          loading={teamLoading}
        />
        <HrStatCard
          color="red"
          icon={<XCircle size={18} />}
          value={counts?.absent ?? 0}
          label="Absent today"
          loading={teamLoading}
        />
        <HrStatCard
          color="blue"
          icon={<Calendar size={18} />}
          value={counts?.onLeave ?? 0}
          label="On leave"
          loading={teamLoading}
        />
        <HrStatCard
          color="orange"
          icon={<AlertCircle size={18} />}
          value={pendingLeaves.length}
          label="Pending approvals"
          loading={approvalsLoading}
        />
      </div>

      {/* Team attendance status */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-text-tertiary" />
            <h2 className="text-sm font-semibold text-text-primary">
              Team attendance — {format(new Date(), 'd MMM')}
            </h2>
          </div>
          <button
            onClick={() => navigate('/hrms/attendance')}
            className="flex items-center gap-1 text-xs font-semibold text-[#C16E00] transition-colors hover:text-[#E08A00]"
          >
            Full view <ArrowRight size={12} />
          </button>
        </div>

        {teamLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-text-tertiary">Loading…</div>
        ) : staffStatuses.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-text-tertiary">
            No team data available for today
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {staffStatuses.slice(0, 8).map((s, i) => {
              const pill = statusPill(s.status)
              return (
                <div key={s.employeeId} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <HrAvatar
                      name={s.fullName ?? '—'}
                      sub={s.jobTitle ?? s.departmentName ?? ''}
                      seed={i}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <HrStatusPill tone={pill.tone}>
                      <span className="capitalize">{pill.label}</span>
                    </HrStatusPill>
                    {s.checkInAt && (
                      <span className="text-xs text-text-tertiary">
                        {format(new Date(s.checkInAt), 'h:mm a')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending leave approvals */}
      {pendingLeaves.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-default bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-text-tertiary" />
              <h2 className="text-sm font-semibold text-text-primary">Pending leave approvals</h2>
              <HrStatusPill tone="warn">{pendingLeaves.length}</HrStatusPill>
            </div>
            <HrButton size="sm" onClick={() => navigate('/hrms/leave')}>
              Approve <ArrowRight size={12} />
            </HrButton>
          </div>
          <div className="divide-y divide-border-default">
            {pendingLeaves.slice(0, 5).map((leave) => (
              <div key={leave.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {leave.leaveTypeName ?? 'Leave request'}
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM')}
                    {' · '}{leave.totalDays}d
                  </p>
                </div>
                <HrStatusPill tone="warn">Pending</HrStatusPill>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
