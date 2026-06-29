import React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { Sparkles, Users, UserPlus, FileText, Settings, ArrowRight, CheckCircle, Clock, Plane } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { useAuthStore } from '@/core/auth/authStore'
import { HrStatCard, HrAvatar, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useTeamDashboard, useTodayAttendance } from '@/modules/hrms/api/useAttendance'
import { useEmployeeDirectory } from '@/modules/hrms/api/useWorkforce'

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }

const STATUS_TONE: Record<string, PillTone> = {
  PRESENT: 'ok', LATE: 'late', ABSENT: 'red', ON_LEAVE: 'purple',
  WORK_FROM_HOME: 'teal', HALF_DAY: 'pink', NOT_MARKED: 'gray',
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user, hasModule, hasPermission } = useAuthStore()

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = format(new Date(), 'EEEE, MMMM d, yyyy')

  const canTeam = hasModule('hrms') && hasPermission('attendance.team.read')
  const canDir = hasPermission('hrms.employee.read')
  const canSelf = hasModule('hrms') && hasPermission('attendance.checkin.self')

  const dateStr = new Date().toISOString().split('T')[0]
  const { data: teamData, isLoading: teamLoading } = useTeamDashboard(dateStr, undefined, canTeam)
  const { data: directory } = useEmployeeDirectory({ page: 0, pageSize: 1 }, { enabled: canDir })
  const { data: todayData } = useTodayAttendance()

  const counts = teamData?.counts
  const totalEmployees = canDir && directory ? directory.totalElements : (teamData?.staffStatuses.length ?? 0)

  const donut = counts ? [
    { name: 'Present', value: counts.present, color: '#22C55E' },
    { name: 'Late', value: counts.late, color: '#F59E0B' },
    { name: 'On Leave', value: counts.onLeave, color: '#8B5CF6' },
    { name: 'WFH', value: counts.workFromHome, color: '#06B6D4' },
    { name: 'Half Day', value: counts.halfDay, color: '#EC4899' },
    { name: 'Absent', value: counts.absent, color: '#EF4444' },
    { name: 'Not Marked', value: counts.notMarked, color: '#9CA3AF' },
  ].filter((d) => d.value > 0) : []
  const totalStaff = donut.reduce((s, d) => s + d.value, 0)

  const QUICK_ACTIONS = [
    { label: 'Add Employee', icon: UserPlus, path: '/hrms/employees', module: 'hrms', anyOf: ['hrms.employee.write'] },
    { label: 'View Directory', icon: Users, path: '/hrms/employees', module: 'hrms', anyOf: ['hrms.employee.read'] },
    { label: 'Run Payroll', icon: FileText, path: '/hrms/payroll/runs', module: 'payroll', anyOf: ['payroll.runs.read'] },
    { label: 'Settings', icon: Settings, path: '/settings', module: 'hrms', anyOf: ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read'] },
  ]

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto w-full max-w-7xl space-y-7 p-6 sm:p-8">
      {/* Welcome banner */}
      <motion.div
        variants={fadeUp}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#7A4400] via-[#C16E00] to-[#FF9D00] p-8 text-white shadow-xl shadow-[#C16E00]/25 sm:p-10"
      >
        <div className="absolute right-0 top-0 h-80 w-80 -translate-y-1/3 translate-x-1/4 rounded-full bg-white/15 blur-[80px]" />
        <div className="absolute bottom-0 left-0 h-80 w-80 -translate-x-1/3 translate-y-1/3 rounded-full bg-[#FFD68A]/25 blur-[80px]" />
        <div className="relative z-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-md">
              <Sparkles size={14} /> Welcome back
            </div>
            <h1 className="mb-1.5 text-3xl font-bold tracking-tight sm:text-[34px]">
              {greeting}, {user?.firstName ?? 'there'} 👋
            </h1>
            <p className="max-w-lg text-sm font-medium text-white/85 sm:text-[15px]">
              {today} — here's what's happening across your workspace today.
            </p>
          </div>
          <span className="hidden items-center gap-2 rounded-xl border border-white/15 bg-black/15 px-4 py-2.5 text-xs font-semibold backdrop-blur-md lg:flex">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            All systems operational
          </span>
        </div>
      </motion.div>

      {/* Team KPIs (managers/HR) */}
      {canTeam && (
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HrStatCard icon={<Users size={18} />} color="blue" value={totalEmployees} label="Total Employees" sub="Directory headcount" loading={teamLoading && !teamData} />
          <HrStatCard icon={<CheckCircle size={18} />} color="green" value={counts?.present ?? 0} label="Present Today" sub="Checked in" loading={teamLoading} />
          <HrStatCard icon={<Clock size={18} />} color="orange" value={counts?.late ?? 0} label="Late Check-ins" sub="Needs attention" loading={teamLoading} />
          <HrStatCard icon={<Plane size={18} />} color="purple" value={counts?.onLeave ?? 0} label="On Leave" sub="Away today" loading={teamLoading} />
        </motion.div>
      )}

      {/* Self KPIs (employees without team visibility) */}
      {!canTeam && canSelf && (
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HrStatCard icon={<CheckCircle size={18} />} color="green" value={(todayData?.attendanceStatus ?? 'NOT MARKED').replace(/_/g, ' ')} label="My Status Today" />
          <HrStatCard icon={<Clock size={18} />} color="orange" value={todayData?.checkInTime ? format(new Date(todayData.checkInTime), 'h:mm a') : '--:--'} label="Check-in Time" />
        </motion.div>
      )}

      {/* Charts + recent activity (managers/HR) */}
      {canTeam && (
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Attendance breakdown donut */}
          <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-text-primary">Today's Attendance</h3>
            <p className="mb-2 text-xs text-text-secondary">Live status across your team</p>
            {totalStaff === 0 ? (
              <div className="flex h-[200px] flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-text-secondary">No attendance marked yet</p>
                <p className="mt-1 text-xs text-text-tertiary">Check back once staff start their day.</p>
              </div>
            ) : (
              <>
                <div className="relative h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="none">
                        {donut.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-text-primary">{totalStaff}</span>
                    <span className="text-[11px] uppercase tracking-wide text-text-tertiary">Staff</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {donut.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="text-text-secondary">{d.name}</span>
                      <span className="ml-auto font-semibold text-text-primary">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Recent attendance logs */}
          <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary">Recent Attendance</h3>
              <button onClick={() => navigate('/hrms/attendance')} className="flex items-center gap-1 text-xs font-semibold text-[#C16E00] hover:text-[#9A5600]">
                View all <ArrowRight size={12} />
              </button>
            </div>
            <div>
              {(teamData?.staffStatuses ?? []).slice(0, 6).map((s, i) => (
                <div key={s.employeeId} className="flex items-center gap-3 border-b border-border-default/60 py-2.5 last:border-0">
                  <HrAvatar name={s.fullName} sub={s.jobTitle ?? s.departmentName} seed={i} />
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-text-tertiary">{s.checkInAt ? format(new Date(s.checkInAt), 'h:mm a') : '—'}</span>
                    <HrStatusPill tone={STATUS_TONE[s.status] ?? 'gray'}>{s.status.replace(/_/g, ' ')}</HrStatusPill>
                  </div>
                </div>
              ))}
              {(!teamData || teamData.staffStatuses.length === 0) && (
                <p className="py-10 text-center text-sm text-text-tertiary">No attendance activity today.</p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div variants={fadeUp} className="space-y-3">
        <h3 className="px-1 text-sm font-bold text-text-primary">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map(({ label, icon: Icon, path, module, anyOf }) => {
            if (module && module !== 'hrms' && !hasModule(module)) return null
            if (anyOf && !anyOf.some((p) => hasPermission(p))) return null
            return (
              <motion.button
                key={label}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate(path)}
                className="group flex items-center gap-3.5 rounded-2xl border border-[#FFD68A] bg-[#FFF8EC] px-5 py-4 text-left transition-all duration-300 hover:border-[#FF9D00] hover:bg-[#FF9D00] hover:shadow-lg hover:shadow-[#FF9D00]/25"
              >
                <div className="rounded-xl bg-white p-2.5 text-[#C16E00] shadow-sm transition-colors group-hover:bg-white/20 group-hover:text-white">
                  <Icon size={20} />
                </div>
                <span className="flex-1 text-sm font-bold text-text-primary group-hover:text-white">{label}</span>
                <ArrowRight size={16} className="text-[#C16E00]/50 transition-all group-hover:translate-x-1 group-hover:text-white" />
              </motion.button>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
