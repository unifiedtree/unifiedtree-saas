import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, Clock, CalendarDays, Building2, Plus, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats } from './api/useAttendance'
import { usePermission, P } from '@unifiedtree/sdk'
import { UpcomingProbations } from './probation/UpcomingProbations'

export const HrmsDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { data: companies = [] } = useCompanies()
  const activeCompany = companies[0]

  const { data: directory } = useEmployeeDirectory({ companyId: activeCompany?.id, pageSize: 5 })
  const { data: leaveOverview } = useLeaveOverview()
  const now = new Date()
  const { data: attendanceStats } = useMonthlyStats(now.getFullYear(), now.getMonth() + 1)

  const totalEmployees = directory?.totalElements ?? 0
  const recentEmployees = directory?.content ?? []
  const pendingLeaves = leaveOverview?.pendingApprovals ?? 0

  // Visibility follows the backend authority the action actually needs, not role
  // membership: createEmployee requires hrms.employee.write; org setup requires
  // org.company.write. So HR_MANAGER (who holds both) sees them, like the backend allows.
  const canWriteEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg = usePermission(P.ORG_COMPANY_WRITE)
  const canSeeProbation = usePermission(P.HRMS_EMPLOYEE_READ)

  const quickActions = [
    ...(canWriteEmployee ? [
      { label: 'Add Employee', icon: Plus, path: '/hrms/employees', color: 'text-brand-600', bg: 'bg-brand-100' },
    ] : []),
    ...(canManageOrg ? [
      { label: 'Org Setup', icon: Building2, path: '/hrms/organization', color: 'text-brand-500', bg: 'bg-brand-50' },
    ] : []),
    { label: 'Attendance', icon: Clock, path: '/hrms/attendance', color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'Leave', icon: CalendarDays, path: '/hrms/leave', color: 'text-amber-600', bg: 'bg-amber-100' },
  ]

  return (
    <div className="space-y-6 font-body">
      <div>
        <h1 className="text-xl font-bold text-text-primary font-heading">HRMS Overview</h1>
        <p className="text-text-secondary text-sm mt-0.5">{activeCompany ? activeCompany.name : 'Human Resources Management System'}</p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div onClick={() => navigate('/hrms/employees')} className="cursor-pointer">
          <StatCard title="Total Employees" value={totalEmployees} icon={Users} iconColor="text-brand-600" iconBg="bg-brand-100" />
        </div>
        <div onClick={() => navigate('/hrms/attendance')} className="cursor-pointer">
          <StatCard title="Present Today" value={attendanceStats?.presentDays ?? '—'} subtitle={attendanceStats ? `Score ${attendanceStats.attendanceScore}%` : undefined} icon={UserCheck} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
        </div>
        <div onClick={() => navigate('/hrms/leave')} className="cursor-pointer">
          <StatCard title="Pending Leaves" value={pendingLeaves} icon={CalendarDays} iconColor="text-amber-600" iconBg="bg-amber-100" />
        </div>
        <div onClick={() => navigate('/hrms/organization')} className="cursor-pointer">
          <StatCard title="Companies" value={companies.length} icon={Building2} iconColor="text-brand-500" iconBg="bg-brand-50" />
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white border border-primary/15 rounded-2xl p-4 shadow-md">
        <h2 className="text-sm font-bold text-text-primary mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="flex flex-col items-center gap-2 p-4 bg-primary/[0.06] hover:bg-primary/[0.12] border border-primary/15 rounded-xl transition-all"
            >
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', a.bg)}>
                <a.icon size={18} className={a.color} />
              </div>
              <span className="text-xs text-text-primary font-bold">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Upcoming probations */}
      {canSeeProbation && <UpcomingProbations />}

      {/* Recent employees */}
      {recentEmployees.length > 0 && (
        <div className="bg-white border border-primary/15 rounded-2xl overflow-hidden shadow-md">
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10 bg-primary/[0.03]">
            <h2 className="text-sm font-bold text-text-primary">Recent Employees</h2>
            <button onClick={() => navigate('/hrms/employees')} className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-dark transition-colors">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-brand-50">
            {recentEmployees.map((emp) => {
              const initials = (emp.firstName[0] ?? '') + (emp.lastName?.[0] ?? '')
              return (
                <div
                  key={emp.id}
                  onClick={() => navigate(`/hrms/employees/${emp.id}`)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-brand-50/50 cursor-pointer transition-colors"
                >
                  <div className="w-8 h-8 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                    {initials.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-bold">{emp.firstName} {emp.lastName}</p>
                    <p className="text-text-secondary text-xs">{emp.email}</p>
                  </div>
                  <span className={clsx('text-xs px-2.5 py-1 rounded-lg font-bold border',
                    emp.employmentStatus === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                    emp.employmentStatus === 'PROBATION' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                    'bg-slate-50 text-slate-500 border-slate-200'
                  )}>
                    {emp.employmentStatus ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
