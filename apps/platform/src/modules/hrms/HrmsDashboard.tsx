import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, Clock, CalendarDays, Building2, Plus, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { HrPageHeader, HrStatCard, HrStatusPill, HrButton, TableCard, HrAvatar } from '@/shared/components/hr'
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
      { label: 'Add Employee', icon: Plus, path: '/hrms/employees', color: 'text-[#C16E00]', bg: 'bg-[#FFF4E1]' },
    ] : []),
    ...(canManageOrg ? [
      { label: 'Org Setup', icon: Building2, path: '/hrms/organization', color: 'text-[#C16E00]', bg: 'bg-[#FFF4E1]' },
    ] : []),
    { label: 'Attendance', icon: Clock, path: '/hrms/attendance', color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'Leave', icon: CalendarDays, path: '/hrms/leave', color: 'text-amber-600', bg: 'bg-amber-100' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 font-body sm:p-8">
      <HrPageHeader
        title="HRMS Overview"
        subtitle={activeCompany ? activeCompany.name : 'Human Resources Management System'}
      />

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div onClick={() => navigate('/hrms/employees')} className="cursor-pointer">
          <HrStatCard icon={<Users size={18} />} color="blue" value={totalEmployees} label="Total Employees" />
        </div>
        <div onClick={() => navigate('/hrms/attendance')} className="cursor-pointer">
          <HrStatCard
            icon={<UserCheck size={18} />}
            color="green"
            value={attendanceStats?.presentDays ?? '—'}
            label="Present Today"
            sub={attendanceStats ? `Score ${attendanceStats.attendanceScore}%` : undefined}
          />
        </div>
        <div onClick={() => navigate('/hrms/leave')} className="cursor-pointer">
          <HrStatCard icon={<CalendarDays size={18} />} color="orange" value={pendingLeaves} label="Pending Leaves" />
        </div>
        <div onClick={() => navigate('/hrms/organization')} className="cursor-pointer">
          <HrStatCard icon={<Building2 size={18} />} color="purple" value={companies.length} label="Companies" />
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white border border-border-default rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-bold text-text-primary mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="flex flex-col items-center gap-2 p-4 bg-[#FFF4E1] hover:bg-[#FFD68A]/40 border border-[#FFD68A] rounded-xl transition-all"
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
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-primary">Recent Employees</h2>
          </div>
          <TableCard
            actions={
              <HrButton variant="ghost" size="sm" onClick={() => navigate('/hrms/employees')}>
                View all <ArrowRight size={12} />
              </HrButton>
            }
          >
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentEmployees.map((emp, i) => {
                  const status = emp.employmentStatus
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => navigate(`/hrms/employees/${emp.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <HrAvatar name={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} seed={i} />
                      </td>
                      <td className="text-text-secondary">{emp.email}</td>
                      <td>
                        <HrStatusPill
                          tone={status === 'ACTIVE' ? 'ok' : status === 'PROBATION' ? 'warn' : 'gray'}
                        >
                          {status ?? '—'}
                        </HrStatusPill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  )
}
