import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { P, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { RouteGuard } from '@/routes/RouteGuard'
import { PlatformShell } from '@/layouts/PlatformShell'
import { LoginPage } from '@/core/auth/LoginPage'
import { Dashboard } from '@/pages/Dashboard'
import { Analytics } from '@/pages/Analytics'
import { Settings } from '@/pages/Settings'
import { AuditLogs } from '@/pages/AuditLogs'
import { Users } from '@/pages/Users'
import { Roles } from '@/pages/Roles'
import { Files } from '@/pages/Files'
import { PendingApproval } from '@/pages/PendingApproval'
import { NoAccess } from '@/pages/NoAccess'
import { AcceptInvite } from '@/pages/AcceptInvite'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { ResetPassword } from '@/pages/ResetPassword'
import { Templates } from '@/modules/hrms/onboarding/Templates'
import { TemplateDetail } from '@/modules/hrms/onboarding/TemplateDetail'
import { Instances } from '@/modules/hrms/onboarding/Instances'
import { InstanceDetail } from '@/modules/hrms/onboarding/InstanceDetail'
import { ModuleGate } from '@/shared/components/ModuleGate'
import { ModulePreview } from '@/shared/components/ModulePreview'
import { Employees } from '@/modules/hrms/Employees'
import { Attendance } from '@/modules/hrms/Attendance'
import { Leave } from '@/modules/hrms/Leave'
import { Payroll } from '@/modules/hrms/Payroll'
import { OrgSetup } from '@/modules/hrms/organization/OrgSetup'
import { EmployeeDetail } from '@/modules/hrms/employees/EmployeeDetail'
import { EssDashboard } from '@/modules/hrms/ess/EssDashboard'
import { TeamDashboard } from '@/modules/hrms/team/TeamDashboard'
import { ReportsIndex } from '@/modules/hrms/reports/ReportsIndex'
import { ProbationSettings } from '@/modules/hrms/probation/ProbationSettings'
import { PayrollSettings } from '@/modules/hrms/payroll/PayrollSettings'
import { SalaryComponents } from '@/modules/hrms/payroll/SalaryComponents'
import { MySalaryStructure } from '@/modules/hrms/payroll/MySalaryStructure'
import { PayrollRuns } from '@/modules/hrms/payroll/PayrollRuns'
import { PayrollRunDetail } from '@/modules/hrms/payroll/PayrollRunDetail'
import { EmployeePayslips } from '@/modules/hrms/payroll/EmployeePayslips'
import { LetterTemplates } from '@/modules/hrms/letters/LetterTemplates'
import { LetterTemplateEditor } from '@/modules/hrms/letters/LetterTemplateEditor'
import { GeneratedLetters } from '@/modules/hrms/letters/GeneratedLetters'
import { GeneratedLetterDetail } from '@/modules/hrms/letters/GeneratedLetterDetail'
import { HeadcountReport } from '@/modules/hrms/reports/HeadcountReport'
import { AttritionReport } from '@/modules/hrms/reports/AttritionReport'
import { AttendanceSummaryReport } from '@/modules/hrms/reports/AttendanceSummaryReport'
import { LeaveBalanceReport } from '@/modules/hrms/reports/LeaveBalanceReport'
import { LateMarksReport } from '@/modules/hrms/reports/LateMarksReport'
import { DiversityReport } from '@/modules/hrms/reports/DiversityReport'
import { EmployeeImport } from '@/modules/hrms/employees/EmployeeImport'

// Priority order: highest privilege wins when resolving landing page
const ROLE_PRIORITY = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'EMPLOYEE'] as const

function RoleAwareLanding() {
  const roles = useSdkStore(s => s.user?.roles ?? [])

  if (roles.includes('SUPER_ADMIN') || roles.includes('HR_MANAGER')) {
    return <Navigate to="/dashboard" replace />
  }
  if (roles.includes('FINANCE_LEAD')) return <Navigate to="/hrms/reports" replace />
  if (roles.includes('DEPT_MANAGER')) return <Navigate to="/team" replace />
  if (roles.includes('EMPLOYEE'))     return <Navigate to="/me" replace />

  return <Navigate to="/no-access" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"            element={<LoginPage />} />
      <Route path="/pending-approval" element={<PendingApproval />} />
      <Route path="/no-access"        element={<NoAccess />} />
      <Route path="/accept-invite"    element={<AcceptInvite />} />
      <Route path="/forgot-password"  element={<ForgotPassword />} />
      <Route path="/reset-password"   element={<ResetPassword />} />

      {/* Protected shell */}
      <Route
        element={
          <RouteGuard>
            <PlatformShell />
          </RouteGuard>
        }
      >
        {/* Role-aware root — redirects based on highest role */}
        <Route path="/"          element={<RoleAwareLanding />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings"  element={<Settings />} />
        <Route path="/users"     element={<Users />} />
        <Route path="/roles"     element={<Roles />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="/files"     element={<Files />} />

        {/* Employee self-service landing */}
        <Route
          path="/me"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><EssDashboard /></ModuleGate>
            </RouteGuard>
          }
        />

        {/* Dept manager team dashboard */}
        <Route
          path="/team"
          element={
            <RouteGuard anyOf={[P.ATTENDANCE_TEAM_READ, P.HRMS_LEAVE_APPROVE_L1, P.HRMS_EMPLOYEE_READ]}>
              <ModuleGate moduleKey="hrms"><TeamDashboard /></ModuleGate>
            </RouteGuard>
          }
        />

        {/* ── HRMS ─────────────────────────────────────────────────────── */}
        <Route
          path="/hrms/employees"
          element={
            <RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ]}>
              <ModuleGate moduleKey="hrms"><Employees /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/employees/import"
          element={
            <RouteGuard anyOf={[P.HRMS_EMPLOYEE_IMPORT]}>
              <ModuleGate moduleKey="hrms"><EmployeeImport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/employees/:id"
          element={
            <RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ]}>
              <ModuleGate moduleKey="hrms"><EmployeeDetail /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/organization"
          element={
            <RouteGuard anyOf={[P.HRMS_DEPARTMENT_READ, P.HRMS_BRANCH_READ]}>
              <ModuleGate moduleKey="hrms"><OrgSetup /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/attendance"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><Attendance /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/leave"
          element={
            <RouteGuard anyOf={[P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF]}>
              <ModuleGate moduleKey="hrms"><Leave /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/ess"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><EssDashboard /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/onboarding"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_TEMPLATE_READ]}>
              <ModuleGate moduleKey="hrms"><Templates /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/onboarding/templates/:id"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_TEMPLATE_READ]}>
              <ModuleGate moduleKey="hrms"><TemplateDetail /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/onboarding/instances"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE]}>
              <ModuleGate moduleKey="hrms"><Instances /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/onboarding/instances/:employeeId"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE]}>
              <ModuleGate moduleKey="hrms"><InstanceDetail /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_HEADCOUNT, P.HRMS_REPORT_ATTRITION, P.HRMS_REPORT_ATTENDANCE, P.HRMS_REPORT_LEAVE, P.HRMS_REPORT_DIVERSITY]}>
              <ModuleGate moduleKey="hrms"><ReportsIndex /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/settings"
          element={
            <RouteGuard anyOf={[P.HRMS_PROBATION_CONFIG_READ]}>
              <ModuleGate moduleKey="hrms"><ProbationSettings /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/settings"
          element={
            <RouteGuard anyOf={[P.PAYROLL_SETTINGS_READ]}>
              <ModuleGate moduleKey="hrms"><PayrollSettings /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/components"
          element={
            <RouteGuard anyOf={[P.PAYROLL_COMPONENTS_READ]}>
              <ModuleGate moduleKey="hrms"><SalaryComponents /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/salary"
          element={
            <RouteGuard anyOf={[P.PAYROLL_STRUCTURE_READ_SELF]}>
              <ModuleGate moduleKey="hrms"><MySalaryStructure /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/runs"
          element={
            <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
              <ModuleGate moduleKey="hrms"><PayrollRuns /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/runs/:id"
          element={
            <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
              <ModuleGate moduleKey="hrms"><PayrollRunDetail /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/payslips"
          element={
            <RouteGuard anyOf={[P.PAYROLL_PAYSLIP_READ_SELF]}>
              <ModuleGate moduleKey="hrms"><EmployeePayslips /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/headcount"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_HEADCOUNT]}>
              <ModuleGate moduleKey="hrms"><HeadcountReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/attrition"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_ATTRITION]}>
              <ModuleGate moduleKey="hrms"><AttritionReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/attendance-summary"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_ATTENDANCE]}>
              <ModuleGate moduleKey="hrms"><AttendanceSummaryReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/leave-balance"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_LEAVE]}>
              <ModuleGate moduleKey="hrms"><LeaveBalanceReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/late-marks"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_ATTENDANCE]}>
              <ModuleGate moduleKey="hrms"><LateMarksReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/reports/diversity"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_DIVERSITY]}>
              <ModuleGate moduleKey="hrms"><DiversityReport /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/letters/templates"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_TEMPLATE_READ]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <LetterTemplates />
                </React.Suspense>
              </ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/letters/templates/:id"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_TEMPLATE_READ]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <LetterTemplateEditor />
                </React.Suspense>
              </ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/letters/generated"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_READ, P.HRMS_LETTERS_READ_SELF]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <GeneratedLetters />
                </React.Suspense>
              </ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/letters/generated/:id"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_READ, P.HRMS_LETTERS_READ_SELF]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <GeneratedLetterDetail />
                </React.Suspense>
              </ModuleGate>
            </RouteGuard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
