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
import { Modules } from '@/pages/Modules'
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
import { ComingSoon } from '@/shared/components/ComingSoon'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { Employees } from '@/modules/hrms/Employees'
import { Attendance } from '@/modules/hrms/Attendance'
import { GeofenceZones } from '@/modules/hrms/attendance/GeofenceZones'
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

// Roles allowed to see the "Not Activated" upsell (they can act on billing).
const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN'] as const

/**
 * Route wrapper for the 10 sellable-but-unbuilt modules.
 *  - Module ACTIVE for the workspace  → <ComingSoon /> (ModuleGate passes through).
 *  - Module NOT active + admin        → ModuleGate falls back to ModuleNotActivated (upsell).
 *  - Module NOT active + non-admin    → redirect to dashboard (never land on a locked route).
 */
function ComingSoonRoute({ moduleKey }: { moduleKey: string }) {
  const isActive = useLocalAuthStore(s => s.tenant?.activeModules.includes(moduleKey) ?? false)
  const roles = useSdkStore(s => s.user?.roles ?? [])
  const isAdmin = roles.some(r => (ADMIN_ROLES as readonly string[]).includes(r))

  if (!isActive && !isAdmin) return <Navigate to="/dashboard" replace />

  return (
    <ModuleGate moduleKey={moduleKey}>
      <ComingSoon module={moduleKey} />
    </ModuleGate>
  )
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
        {/* Platform-admin pages. These were previously reachable by direct URL for any
            authenticated user (the sidebar hid them by role, and the backend 403'd the
            data fetch — so a non-admin saw a broken "failed to load" page rather than a
            clean denial). Guard them on the same permission the page's data requires so
            non-admins get "Access Restricted" up front. (super-admin holds all three.) */}
        <Route path="/users"      element={<RouteGuard anyOf={[P.WORKSPACE_USERS_READ]}><Users /></RouteGuard>} />
        <Route path="/roles"      element={<RouteGuard anyOf={[P.RBAC_ROLE_WRITE]}><Roles /></RouteGuard>} />
        <Route path="/audit-logs" element={<RouteGuard anyOf={[P.AUDIT_READ]}><AuditLogs /></RouteGuard>} />
        {/* Admin-only Modules manager. Guarded on the module-management perms; the '*'
            wildcard lets super-admins (who hold a wildcard-only grant) through, mirroring
            the gating agent's admin definition (roles ∪ permissions.has('*')). */}
        <Route path="/modules"    element={<RouteGuard anyOf={[P.PLATFORM_MODULE_MANAGE, P.TENANT_MODULE_ACTIVATE, '*']}><Modules /></RouteGuard>} />
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
        {/* Admin/manager geofencing zones. Read needs attendance.team.read,
            write needs org.geofence.write — backend enforces both. */}
        <Route
          path="/hrms/attendance/geofencing"
          element={
            <RouteGuard anyOf={[P.ORG_GEOFENCE_WRITE, P.ATTENDANCE_TEAM_READ]}>
              <ModuleGate moduleKey="hrms"><GeofenceZones /></ModuleGate>
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

        {/* ── Sellable "coming soon" modules ───────────────────────────────
            The 10 canonical non-HRMS module keys have no real backend yet.
            Each renders <ComingSoon> when the workspace owns the module, and
            falls back to the ModuleGate upsell (admins) / dashboard (others)
            when it is not active. Both the canonical-key path and the legacy
            nav path are registered so clicking the sidebar item never lands on
            a blank/broken page. */}
        <Route path="/payroll"            element={<ComingSoonRoute moduleKey="payroll" />} />
        <Route path="/accounting"         element={<ComingSoonRoute moduleKey="accounting" />} />
        <Route path="/accounts/*"         element={<ComingSoonRoute moduleKey="accounting" />} />
        <Route path="/inventory"          element={<ComingSoonRoute moduleKey="inventory" />} />
        <Route path="/crm"                element={<ComingSoonRoute moduleKey="crm" />} />
        <Route path="/crm/*"              element={<ComingSoonRoute moduleKey="crm" />} />
        <Route path="/purchase"           element={<ComingSoonRoute moduleKey="purchase" />} />
        <Route path="/procurement"        element={<ComingSoonRoute moduleKey="purchase" />} />
        <Route path="/sales"              element={<ComingSoonRoute moduleKey="sales" />} />
        <Route path="/projects"           element={<ComingSoonRoute moduleKey="projects" />} />
        <Route path="/projects/*"         element={<ComingSoonRoute moduleKey="projects" />} />
        <Route path="/manufacturing"      element={<ComingSoonRoute moduleKey="manufacturing" />} />
        <Route path="/pos"                element={<ComingSoonRoute moduleKey="pos" />} />
        <Route path="/reports"            element={<ComingSoonRoute moduleKey="reports" />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
