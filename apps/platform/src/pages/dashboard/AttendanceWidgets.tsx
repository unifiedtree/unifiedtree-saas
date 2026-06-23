import React from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { Users, CheckCircle, HelpCircle, Clock, ArrowUpRight } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { StatCard } from '@/shared/components/StatCard'
import { useTeamDashboard, useTodayAttendance } from '@/modules/hrms/api/useAttendance'
import { useEmployeeDirectory } from '@/modules/hrms/api/useWorkforce'

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }

export const TeamAttendanceWidgets: React.FC = () => {
  const navigate = useNavigate()
  const dateStr = new Date().toISOString().split('T')[0]
  // We already checked permissions before rendering this component
  const { data: teamData } = useTeamDashboard(dateStr, undefined, true)

  // "Total Employees" is the HR directory headcount, not today's attendance roster.
  // Only fetch the directory when the user may read it; otherwise fall back to the
  // attendance roster count so attendance-only managers still see a number.
  const canReadDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const { data: directory } = useEmployeeDirectory({ page: 0, pageSize: 1 }, { enabled: canReadDirectory })
  const totalEmployees = canReadDirectory && directory
    ? directory.totalElements.toString()
    : (teamData?.staffStatuses.length.toString() ?? '0')

  return (
    <>
      <h3 className="font-display text-lg font-semibold text-brand-900 mt-6 mb-2">Team Attendance</h3>
      {/* Stats */}
      <motion.div variants={stagger} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Employees" value={totalEmployees} change="Directory headcount" changeType="neutral" icon={Users} iconColor="text-brand-600" iconBg="bg-brand-soft" subtitle="Across all departments" />
        <StatCard title="Present Today" value={teamData?.counts.present.toString() ?? '0'} change="Currently checked in" changeType="positive" icon={CheckCircle} iconColor="text-brand-mint" iconBg="bg-brand-100" subtitle="Staff members" />
        <StatCard title="Late Check-ins" value={teamData?.counts.late.toString() ?? '0'} change="Needs attention" changeType="negative" icon={HelpCircle} iconColor="text-peach-500" iconBg="bg-peach-50" subtitle="Staff members" />
        <StatCard title="Not Marked" value={teamData?.counts.notMarked.toString() ?? '0'} change="Pending check-in" changeType="neutral" icon={Clock} iconColor="text-amber-500" iconBg="bg-amber-50" subtitle="Staff members" />
      </motion.div>

      <motion.div variants={fadeUp} className="mt-4 rounded-2xl border border-brand-100 bg-white p-5 shadow-card max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base text-brand-900">Recent Attendance Logs</h3>
          <button
            onClick={() => navigate('/hrms/attendance')}
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            View all <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="space-y-1">
          {teamData?.staffStatuses.slice(0, 5).map((item) => (
            <div key={item.employeeId} className="flex items-center gap-3 border-b border-brand-100/60 py-2.5 last:border-0">
              <div className="relative flex-shrink-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-[#0F172A] shadow-soft">
                  {item.fullName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${item.status === 'PRESENT' ? 'bg-brand-500' : item.status === 'LATE' ? 'bg-amber-500' : 'bg-slate-400'}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-brand-900/75">
                  <span className="font-semibold text-brand-900">{item.fullName}</span> marked as {item.status}
                </p>
              </div>
              <span className="flex-shrink-0 text-xs text-brand-900/45">
                {item.checkInAt ? format(new Date(item.checkInAt), 'h:mm a') : ''}
              </span>
            </div>
          ))}
          {(!teamData || teamData.staffStatuses.length === 0) && (
            <p className="text-sm text-brand-900/50 py-4 text-center">No attendance activity today.</p>
          )}
        </div>
      </motion.div>
    </>
  )
}

export const MyAttendanceWidgets: React.FC = () => {
  const { data: todayData } = useTodayAttendance()

  return (
    <>
      <h3 className="font-display text-lg font-semibold text-brand-900 mt-6 mb-2">My Attendance</h3>
      <motion.div variants={stagger} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="My Status" value={todayData?.attendanceStatus ?? 'NOT_MARKED'} change="Today" changeType="neutral" icon={CheckCircle} iconColor="text-brand-600" iconBg="bg-brand-soft" />
        <StatCard title="Check In Time" value={todayData?.checkInTime ? format(new Date(todayData.checkInTime), 'h:mm a') : '--:--'} change="Today" changeType="neutral" icon={Clock} iconColor="text-amber-500" iconBg="bg-amber-50" />
      </motion.div>
    </>
  )
}
