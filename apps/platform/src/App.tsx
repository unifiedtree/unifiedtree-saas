import React from 'react'
import { Routes, Route, Navigate, useLocation, createRoutesFromChildren } from 'react-router-dom'
import { lazyPage, registerRoutes } from '@/shared/routing/lazyPage'
import { P, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { RouteGuard } from '@/routes/RouteGuard'
import { RouteErrorBoundary } from '@/shared/components/RouteErrorBoundary'
import { RequirePermission } from '@/core/permissions/RequirePermission'
import { PlatformShell } from '@/layouts/PlatformShell'
import { LoginPage } from '@/core/auth/LoginPage'
// The Keka-style HRMS analytics board (client redesign 2026-08-11) replaces the
// old pages/Dashboard welcome screen as the module home.

import { PendingApproval } from '@/pages/PendingApproval'
import { NoAccess } from '@/pages/NoAccess'
import { AcceptInvite } from '@/pages/AcceptInvite'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { ResetPassword } from '@/pages/ResetPassword'

// import { Templates } from '@/modules/hrms/onboarding/Templates'
// import { TemplateDetail } from '@/modules/hrms/onboarding/TemplateDetail'
// import { Instances } from '@/modules/hrms/onboarding/Instances'
// import { InstanceDetail } from '@/modules/hrms/onboarding/InstanceDetail'
import { OnboardingForm } from '@/modules/hrms/onboarding/OnboardingForm'

import { ModuleGate } from '@/shared/components/ModuleGate'
import { ModulePreview } from '@/shared/components/ModulePreview'
import { ComingSoon } from '@/shared/components/ComingSoon'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
// Canonical admin-roles SSOT — do NOT redeclare locally. See useRoles.ts.
import { ADMIN_ROLES } from '@/shared/hooks/useRoles'

import { ModuleComingSoon } from '@/shared/components/ModuleComingSoon'

//   // route disabled — see /module-workspace redirect below

// Priority order: highest privilege wins when resolving landing page

// 2026-09-17: route-level code splitting. Every module/page component below is
// lazy-loaded so an EMPLOYEE who only ever opens /me does not download the whole
// admin surface (payroll, reports, letters with @tiptap, bulk import, roles,
// audit-log viewer). The Routes tree is wrapped in <React.Suspense> so a lazy
// chunk fetching in flight shows a spinner instead of the last route flashing.
const Dashboard = lazyPage(() => import('@/modules/hrms/HrmsDashboard').then(m => ({ default: m.HrmsDashboard })))
const Settings = lazyPage(() => import('@/pages/Settings').then(m => ({ default: m.Settings })))
const Profile = lazyPage(() => import('@/pages/Profile').then(m => ({ default: m.Profile })))
const AuditLogs = lazyPage(() => import('@/pages/AuditLogs').then(m => ({ default: m.AuditLogs })))
const Users = lazyPage(() => import('@/pages/Users').then(m => ({ default: m.Users })))
const Roles = lazyPage(() => import('@/pages/Roles').then(m => ({ default: m.Roles })))
const Modules = lazyPage(() => import('@/pages/Modules').then(m => ({ default: m.Modules })))
const Plan = lazyPage(() => import('@/pages/Plan').then(m => ({ default: m.Plan })))
const Templates = lazyPage(() => import('@/modules/hrms/onboarding/Templates').then(m => ({ default: m.Templates })))
const TemplateDetail = lazyPage(() => import('@/modules/hrms/onboarding/TemplateDetail').then(m => ({ default: m.TemplateDetail })))
const Instances = lazyPage(() => import('@/modules/hrms/onboarding/Instances').then(m => ({ default: m.Instances })))
const InstanceDetail = lazyPage(() => import('@/modules/hrms/onboarding/InstanceDetail').then(m => ({ default: m.InstanceDetail })))
const MasterModule = lazyPage(() => import('@/modules/hrms/master/MasterContainer').then(m => ({ default: m.MasterContainer })))
// Attendance & Time (Analytics · Daily Tracking · Shifts & Overtime) — one designed page, three routes.
const AttendanceModule = lazyPage(() => import('@/modules/hrms/attendance/AttendanceContainer').then(m => ({ default: m.AttendanceContainer })))
const GeofenceZones = lazyPage(() => import('@/modules/hrms/attendance/GeofenceZones').then(m => ({ default: m.GeofenceZones })))
const Leave = lazyPage(() => import('@/modules/hrms/Leave').then(m => ({ default: m.Leave })))
const Companies = lazyPage(() => import('@/modules/hrms/organization/CompaniesPageContainer').then(m => ({ default: m.CompaniesPageContainer })))
const EmployeeDetail = lazyPage(() => import('@/modules/hrms/employees/EmployeeDetail').then(m => ({ default: m.EmployeeDetail })))
const EssDashboard = lazyPage(() => import('@/modules/hrms/ess/EssDashboard').then(m => ({ default: m.EssDashboard })))
const ShiftChangeRequest = lazyPage(() => import('@/modules/hrms/shifts/ShiftChangeRequest').then(m => ({ default: m.ShiftChangeRequest })))
const TeamDashboard = lazyPage(() => import('@/modules/hrms/team/TeamDashboard').then(m => ({ default: m.TeamDashboard })))
const ReportsIndex = lazyPage(() => import('@/modules/hrms/reports/ReportsIndex').then(m => ({ default: m.ReportsIndex })))
const HrConfigurationPage = lazyPage(() => import('@/modules/hrms/settings/HrConfigurationPage').then(m => ({ default: m.HrConfigurationPage })))
const Expense = lazyPage(() => import('@/modules/hrms/Expense').then(m => ({ default: m.Expense })))
const FullAndFinal = lazyPage(() => import('@/modules/hrms/FullAndFinal').then(m => ({ default: m.FullAndFinal })))
const ExitCenter = lazyPage(() => import('@/modules/hrms/exit/ExitCenter').then(m => ({ default: m.ExitCenter })))
const Hiring = lazyPage(() => import('@/modules/hrms/Hiring').then(m => ({ default: m.Hiring })))
const Performance = lazyPage(() => import('@/modules/hrms/Performance').then(m => ({ default: m.Performance })))
const WorkforceAnalytics = lazyPage(() => import('@/modules/hrms/analytics/WorkforceAnalytics').then(m => ({ default: m.WorkforceAnalytics })))
// Payroll (Dashboard · Salary Structure · Processing & Payslips · Settings · PLI · Advances · Bank) — one designed page.
const PayrollModule = lazyPage(() => import('@/modules/hrms/payroll/PayrollContainer').then(m => ({ default: m.PayrollContainer })))
const MusterRoll = lazyPage(() => import('@/modules/hrms/attendance/MusterRoll').then(m => ({ default: m.MusterRoll })))
const ManualEntry = lazyPage(() => import('@/modules/hrms/attendance/ManualEntry').then(m => ({ default: m.ManualEntry })))
const BankDisbursement = lazyPage(() => import('@/modules/hrms/payroll/BankDisbursement').then(m => ({ default: m.BankDisbursement })))
const DocumentVault = lazyPage(() => import('@/modules/hrms/DocumentVault').then(m => ({ default: m.DocumentVault })))
const PendingDocuments = lazyPage(() => import('@/pages/PendingDocuments').then(m => ({ default: m.PendingDocuments })))
const Learning = lazyPage(() => import('@/modules/hrms/Learning').then(m => ({ default: m.Learning })))
const Compliance = lazyPage(() => import('@/modules/hrms/Compliance').then(m => ({ default: m.Compliance })))
const Policies = lazyPage(() => import('@/modules/hrms/Policies').then(m => ({ default: m.Policies })))
/** Policy admins get the Master "Policy Documents" page; everyone else keeps the page where they read and acknowledge policies. */
function PoliciesRoute() {
  const admin = useSdkStore(s => s.permissions.has('hrms.policy.write') && s.permissions.has('hrms.policy.read'))
  return admin ? <MasterModule /> : <Policies />
}
const Integrations = lazyPage(() => import('@/modules/hrms/Integrations').then(m => ({ default: m.Integrations })))
const NotificationTemplates = lazyPage(() => import('@/modules/hrms/NotificationTemplates').then(m => ({ default: m.NotificationTemplates })))
const MySalaryStructure = lazyPage(() => import('@/modules/hrms/payroll/MySalaryStructure').then(m => ({ default: m.MySalaryStructure })))
const EmployeePayslips = lazyPage(() => import('@/modules/hrms/payroll/EmployeePayslips').then(m => ({ default: m.EmployeePayslips })))
const LetterTemplates = lazyPage(() => import('@/modules/hrms/letters/LetterTemplates').then(m => ({ default: m.LetterTemplates })))
const LetterTemplateEditor = lazyPage(() => import('@/modules/hrms/letters/LetterTemplateEditor').then(m => ({ default: m.LetterTemplateEditor })))
const GeneratedLetters = lazyPage(() => import('@/modules/hrms/letters/GeneratedLetters').then(m => ({ default: m.GeneratedLetters })))
const GeneratedLetterDetail = lazyPage(() => import('@/modules/hrms/letters/GeneratedLetterDetail').then(m => ({ default: m.GeneratedLetterDetail })))
const Distributions = lazyPage(() => import('@/modules/hrms/letters/Distributions').then(m => ({ default: m.Distributions })))
const DistributionDetail = lazyPage(() => import('@/modules/hrms/letters/DistributionDetail').then(m => ({ default: m.DistributionDetail })))
const HeadcountReport = lazyPage(() => import('@/modules/hrms/reports/HeadcountReport').then(m => ({ default: m.HeadcountReport })))
const AttritionReport = lazyPage(() => import('@/modules/hrms/reports/AttritionReport').then(m => ({ default: m.AttritionReport })))
const AttendanceSummaryReport = lazyPage(() => import('@/modules/hrms/reports/AttendanceSummaryReport').then(m => ({ default: m.AttendanceSummaryReport })))
const LeaveBalanceReport = lazyPage(() => import('@/modules/hrms/reports/LeaveBalanceReport').then(m => ({ default: m.LeaveBalanceReport })))
const LateMarksReport = lazyPage(() => import('@/modules/hrms/reports/LateMarksReport').then(m => ({ default: m.LateMarksReport })))
const DiversityReport = lazyPage(() => import('@/modules/hrms/reports/DiversityReport').then(m => ({ default: m.DiversityReport })))
const EmployeeImport = lazyPage(() => import('@/modules/hrms/employees/EmployeeImport').then(m => ({ default: m.EmployeeImport })))
const ApplyWfh = lazyPage(() => import('@/modules/hrms/wfh/ApplyWfh').then(m => ({ default: m.ApplyWfh })))
const MyAssets = lazyPage(() => import('@/modules/hrms/onboarding/MyAssets').then(m => ({ default: m.MyAssets })))
const MyInterviews = lazyPage(() => import('@/modules/hrms/hiring/Interviews').then(m => ({ default: m.MyInterviews })))
const ModuleWorkspace = lazyPage(() => import('@/pages/ModuleWorkspace').then(m => ({ default: m.ModuleWorkspace })))
const ROLE_PRIORITY = ['SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'EMPLOYEE'] as const

function RoleAwareLanding() {
  const roles = useSdkStore(s => s.user?.roles ?? [])

  // Every authenticated user lands on the app launcher (Odoo-style) — so the
  // website → workspace SSO hand-off drops straight into "modules", no second
  // login and no role-specific detour. Each app's routes stay per-route gated.
  if (roles.length > 0) return <Navigate to="/modules" replace />

  return <Navigate to="/no-access" replace />
}

/**
 * Route wrapper for the 10 sellable-but-unbuilt modules.
 *
 * ADMIN_ROLES is the canonical SSOT imported from useRoles — the earlier
 * local `['SUPER_ADMIN', 'COMPANY_ADMIN']` list omitted OWNER + ADMIN,
 * so an OWNER-only principal hitting /accounts fell through to /dashboard.
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

const InspectorView = lazyPage(() => import('@/modules/hrms/compliance/InspectorView'))

/** Every route. Kept outside App so the table can also be registered for preloading (lazyPage.ts). */
const ROUTE_TREE = (
  <>
      {/* Public */}
      <Route path="/inspection" element={<InspectorView />} />
      <Route path="/login"            element={<LoginPage />} />
      <Route path="/pending-approval" element={<PendingApproval />} />
      <Route path="/no-access"        element={<NoAccess />} />
      <Route path="/accept-invite"    element={<AcceptInvite />} />
      <Route path="/forgot-password"  element={<ForgotPassword />} />
      <Route path="/reset-password"   element={<ResetPassword />} />

      {/* Module-workspace showcase. Rendered OUTSIDE <PlatformShell> on purpose:
          the page brings its own chrome (dark icon rail + top bar + sub-tab row),
          so nesting it in the shell would stack two sidebars and two headers.
          Auth-only — it is presentational, with dummy data and no API calls.

          REDIRECTED 2026-08-10: the page ships fabricated employees, invented
          KPIs (Rs 4.82 Cr) and a made-up "Acme Manufacturing" company under
          the signed-in user's own login. Landing a real customer on that
          screen destroys their trust in every other number the platform
          shows. The file stays on disk so the design work isn't lost — the
          route just doesn't reach it. Delete the file (and this route)
          entirely when a real replacement lands. */}
      <Route path="/module-workspace" element={<Navigate to="/dashboard" replace />} />

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
        {/* AUTH-ONLY (intentional): the dashboard is the universal post-login landing
            every authenticated user must reach; it carries no privileged data of its own
            (each widget fetches behind its own permission and 403s independently). */}
        <Route path="/dashboard" element={<Dashboard />} />
        {/* AUTH-ONLY (intentional): Analytics renders mock KPIs (no backend yet) — shows the
            ComingSoon placeholder, not real data. No permission to gate on until it ships. */}
        <Route path="/analytics" element={<ComingSoon module="analytics" />} />
        {/* Gated on any settings capability so non-admins (e.g. plain EMPLOYEE) get a clean
            "Access Restricted" instead of an empty page; matches the sidebar's Settings gate. */}
        <Route path="/settings"      element={<RouteGuard anyOf={[P.SETTINGS_READ, P.SETTINGS_HRCONFIG_WRITE, P.SETTINGS_HOLIDAYS_WRITE, P.HRMS_PROBATION_CONFIG_READ]}><Settings /></RouteGuard>} />
        {/* Two tabs of the settings page carry destructive/financial authority
            and get their own gated routes so a plain SETTINGS_READ user can't
            deep-link into them. React Router v6 matches the static paths in
            preference to the /:tab wildcard below, so ordering is safe. */}
        <Route path="/settings/billing" element={<RequirePermission code={P.WORKSPACE_BILLING_MANAGE}><Settings tab="billing" /></RequirePermission>} />
        <Route path="/settings/danger"  element={<RequirePermission code={P.TENANT_SETTINGS_WRITE}><Settings tab="danger" /></RequirePermission>} />
        <Route path="/settings/:tab" element={<RouteGuard anyOf={[P.SETTINGS_READ, P.SETTINGS_HRCONFIG_WRITE, P.SETTINGS_HOLIDAYS_WRITE, P.HRMS_PROBATION_CONFIG_READ]}><Settings /></RouteGuard>} />
        {/* Personal profile page. Auth-only (no permission gate) — every
            signed-in user is allowed to view and edit their own profile;
            the backend's /v1/users/me enforces "you can only touch yourself". */}
        <Route path="/profile"       element={<Profile />} />
        {/* Platform-admin pages. These were previously reachable by direct URL for any
            authenticated user (the sidebar hid them by role, and the backend 403'd the
            data fetch — so a non-admin saw a broken "failed to load" page rather than a
            clean denial). Guard them on the same permission the page's data requires so
            non-admins get "Access Restricted" up front. (super-admin holds all three.) */}
        <Route path="/users"      element={<RouteGuard anyOf={[P.WORKSPACE_USERS_READ]}><Users /></RouteGuard>} />
        <Route path="/roles"      element={<RouteGuard anyOf={[P.RBAC_ROLE_WRITE, P.PLATFORM_ADMIN]}><Roles /></RouteGuard>} />
        <Route path="/audit-logs" element={<RouteGuard anyOf={[P.AUDIT_READ]}><AuditLogs /></RouteGuard>} />
        {/* App launcher (Odoo-style). The universal post-login landing / app picker —
            open to every authenticated user. Entering a specific app's routes is still
            gated per-route below, so this only chooses where to go, never grants access. */}
        <Route path="/modules"    element={<Modules />} />
        {/* In-workspace plan configurator + autopay setup. Admin-only; the
            page itself renders a "you must be an admin" guard for non-admins,
            so no RouteGuard wrapper needed (permissions vary per workspace). */}
        <Route path="/plan"       element={<Plan />} />
        {/* AUTH-ONLY (intentional): Files is fully mock (no backend yet) — shows the
            ComingSoon placeholder, not real data. No permission to gate on until it ships. */}
        <Route path="/files"     element={<ComingSoon module="files" />} />

        {/* Employee self-service landing */}
        <Route
          path="/me"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><EssDashboard /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/shift-change"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><ShiftChangeRequest /></ModuleGate>
            </RouteGuard>
          }
        />

        {/* Employee "Apply for Work From Home" — gated on the same wfh.request.self
            authority the backend requires (POST /v1/wfh). Falls back to ESS_READ
            so employees whose role only bundles the generic self-service perm
            still see the page (the submit endpoint will 403 with a clear
            "permission denied" if the tenant hasn't granted wfh.request.self). */}
        <Route
          path="/me/wfh"
          element={
            <RouteGuard anyOf={['wfh.request.self', P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><ApplyWfh /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* My assets and My interviews (V143.20): the caller's own equipment, and
            the interviews they were asked to take (with their scorecard). */}
        <Route
          path="/me/assets"
          element={
            <RouteGuard anyOf={['hrms.onboarding.asset.self']}>
              <ModuleGate moduleKey="hrms"><MyAssets /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/interviews"
          element={
            <RouteGuard anyOf={['hrms.hiring.interview.self', 'hrms.hiring.read']}>
              <ModuleGate moduleKey="hrms"><MyInterviews /></ModuleGate>
            </RouteGuard>
          }
        />

        {/* Dept manager team dashboard.
            HRMS_EMPLOYEE_READ was removed from the anyOf list because HR/admin
            hold it broadly and were landing on a manager-only screen from every
            employee-directory deep link. Guard on team-attendance + first-line
            leave approval, both of which are dept-manager authorities. */}
        <Route
          path="/team"
          element={
            <RouteGuard anyOf={[P.ATTENDANCE_TEAM_READ, P.HRMS_LEAVE_APPROVE_L1]}>
              <ModuleGate moduleKey="hrms"><TeamDashboard /></ModuleGate>
            </RouteGuard>
          }
        />

        {/* ── HRMS ─────────────────────────────────────────────────────── */}
        <Route
          path="/hrms/employees"
          element={
            <RequirePermission code={P.HRMS_EMPLOYEE_READ}>
              <RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ]}>
                <ModuleGate moduleKey="hrms"><MasterModule /></ModuleGate>
              </RouteGuard>
            </RequirePermission>
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
            // Also allow a manager to open a direct report's profile: the
            // backend already scopes /employees/{id} to HR/admin OR the caller
            // being the reporting manager. Without ATTENDANCE_TEAM_READ here,
            // clicking a name on the Team roster hit "Access Restricted".
            <RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_TEAM_READ]}>
              <ModuleGate moduleKey="hrms"><EmployeeDetail /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* Master data (design: docs/Designs/UnifiedTree Master (offline).html). Each
            section checks its own permissions; the overview shows the ones you can open. */}
        <Route
          path="/hrms/master/*"
          element={
            <RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ, P.HRMS_DEPARTMENT_WRITE, P.HRMS_BRANCH_WRITE, P.HRMS_DESIGNATION_WRITE, P.HRMS_CONTRACTOR_READ, P.LEAVE_TYPE_WRITE, 'hrms.policy.write', 'attendance.workforce.admin', P.PAYROLL_COMPONENTS_READ, P.PAYROLL_SETTINGS_READ]}>
              <ModuleGate moduleKey="hrms"><MasterModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/organization"
          element={
            // A setup page: every employee holds department.read (for their own
            // lookups), which let them open it and hit 403s on the Branches tab.
            <RouteGuard anyOf={[P.HRMS_DEPARTMENT_WRITE, P.HRMS_BRANCH_WRITE, P.HRMS_DESIGNATION_WRITE]}>
              <ModuleGate moduleKey="hrms"><MasterModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/companies"
          element={
            <RouteGuard anyOf={[P.HRMS_BRANCH_READ]}>
              <ModuleGate moduleKey="hrms"><Companies /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/attendance"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><AttendanceModule /></ModuleGate>
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
          path="/hrms/expenses"
          element={
            <RouteGuard anyOf={['hrms.expense.claim.self', 'hrms.expense.claim.read', 'hrms.expense.claim.approve', 'hrms.expense.policy.read', 'hrms.expense.reimbursement', 'hrms.reimb_batch.read']}>
              <ModuleGate moduleKey="hrms"><Expense /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/advances"
          element={
            <RouteGuard anyOf={['hrms.advance.request.self', 'hrms.advance.read', 'hrms.advance.approve', 'hrms.advance.disburse']}>
              <ModuleGate moduleKey="hrms"><PayrollModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/exit"
          element={
            <RouteGuard anyOf={['hrms.employee.read', 'hrms.employee.write']}>
              <ModuleGate moduleKey="hrms"><ExitCenter /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/fnf"
          element={
            <RouteGuard anyOf={['hrms.fnf.read', 'hrms.fnf.process', 'hrms.fnf.approve']}>
              <ModuleGate moduleKey="payroll"><FullAndFinal /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/hiring"
          element={
            <RouteGuard anyOf={['hrms.hiring.read', 'hrms.hiring.write', 'hrms.hiring.candidate.write', 'hrms.hiring.offer.read']}>
              <ModuleGate moduleKey="hrms"><Hiring /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/performance"
          element={
            <RouteGuard anyOf={['hrms.performance.read', 'hrms.performance.write', 'hrms.performance.review.self']}>
              <ModuleGate moduleKey="hrms"><Performance /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/workforce-analytics"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_HEADCOUNT, P.HRMS_REPORT_ATTRITION, P.HRMS_REPORT_DIVERSITY]}>
              <ModuleGate moduleKey="hrms"><WorkforceAnalytics /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/att-analytics"
          element={
            <RouteGuard anyOf={[P.HRMS_REPORT_ATTENDANCE, 'attendance.team.read']}>
              <ModuleGate moduleKey="hrms"><AttendanceModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll-dashboard"
          element={
            <RequirePermission code={P.PAYROLL_RUNS_READ}>
              <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
                <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
              </RouteGuard>
            </RequirePermission>
          }
        />
        <Route
          path="/hrms/salary-structure"
          element={
            <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
              <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/muster-roll"
          element={
            <RouteGuard anyOf={['attendance.team.read', P.HRMS_EMPLOYEE_READ]}>
              <ModuleGate moduleKey="hrms"><MusterRoll /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* Admin/HR manual attendance entry (punch on behalf). Backend
            requires attendance.regularization.approve; team.read is accepted
            here so a manager landing on the page from the muster-roll deep
            link sees the form (submit will 403 cleanly if their role lacks
            the write authority). */}
        <Route
          path="/hrms/attendance/manual-entry"
          element={
            <RouteGuard anyOf={['attendance.regularization.approve', 'attendance.team.read']}>
              <ModuleGate moduleKey="hrms"><ManualEntry /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* HR Configuration opened at its Work week section (old link). */}
        <Route
          path="/hrms/settings/work-time"
          element={
            <RouteGuard anyOf={[P.SETTINGS_HRCONFIG_WRITE, P.SETTINGS_READ, P.HRMS_PROBATION_CONFIG_READ]}>
              <ModuleGate moduleKey="hrms"><HrConfigurationPage /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/bank-disbursement"
          element={
            <RequirePermission code={P.PAYROLL_RUNS_READ}>
              <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
                <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
              </RouteGuard>
            </RequirePermission>
          }
        />
        {/* Bank profiles (and the full batch tools) — linked from the designed Bank Disbursement page. */}
        <Route
          path="/hrms/bank-disbursement/setup"
          element={
            <RequirePermission code={P.PAYROLL_RUNS_READ}>
              <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
                <ModuleGate moduleKey="payroll"><BankDisbursement /></ModuleGate>
              </RouteGuard>
            </RequirePermission>
          }
        />
        <Route
          path="/hrms/documents"
          element={
            <RouteGuard anyOf={['hrms.document.read.self', 'hrms.document.read', 'hrms.document.write', 'hrms.letters.template.read']}>
              <ModuleGate moduleKey="hrms"><DocumentVault /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* HR "documents to review" queue. Two paths for the SAME screen —
            the notification listener emitted `/documents/pending` in production
            bells before this page existed, and we keep that link alive so old
            notifications still open something instead of 404-ing. */}
        <Route
          path="/hrms/documents/pending"
          element={
            <RouteGuard anyOf={['hrms.document.verify']}>
              <ModuleGate moduleKey="hrms"><PendingDocuments /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/documents/pending"
          element={
            <RouteGuard anyOf={['hrms.document.verify']}>
              <ModuleGate moduleKey="hrms"><PendingDocuments /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/learning"
          element={
            <RouteGuard anyOf={['hrms.learning.read', 'hrms.learning.write', 'hrms.learning.enroll.self', 'hrms.learning.skill.read']}>
              <ModuleGate moduleKey="hrms"><Learning /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/compliance"
          element={
            <RouteGuard anyOf={['hrms.compliance.read', 'hrms.compliance.write', 'hrms.compliance.posh', 'hrms.compliance.inspector.read']}>
              <ModuleGate moduleKey="hrms"><Compliance /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/policies"
          element={
            <RouteGuard anyOf={['hrms.policy.read', 'hrms.policy.write', 'hrms.policy.acknowledge.self']}>
              <ModuleGate moduleKey="hrms"><PoliciesRoute /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/pli"
          element={
            <RouteGuard anyOf={['hrms.pli.read', 'hrms.pli.write', 'hrms.pli.read.self']}>
              <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/integrations"
          element={
            <RouteGuard anyOf={['hrms.integration.read', 'hrms.integration.write']}>
              <ModuleGate moduleKey="hrms"><Integrations /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/notification-templates"
          element={
            <RouteGuard anyOf={['hrms.notiftemplate.read', 'hrms.notiftemplate.write']}>
              <ModuleGate moduleKey="hrms"><NotificationTemplates /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/shifts"
          element={
            <RouteGuard anyOf={['attendance.team.read', P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><AttendanceModule /></ModuleGate>
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
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read']}>
              <ModuleGate moduleKey="hrms"><Instances /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* Must precede :instanceId — otherwise "new" matches as an id. */}
        <Route
          path="/hrms/onboarding/instances/new"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_INSTANCE_WRITE]}>
              <ModuleGate moduleKey="hrms"><OnboardingForm /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/onboarding/instances/:instanceId"
          element={
            <RouteGuard anyOf={[P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read']}>
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
            <RouteGuard anyOf={[P.SETTINGS_HRCONFIG_WRITE, P.SETTINGS_READ, P.HRMS_PROBATION_CONFIG_READ]}>
              <ModuleGate moduleKey="hrms"><HrConfigurationPage /></ModuleGate>
            </RouteGuard>
          }
        />
        {/* Placeholder for client HR screens still being built — keeps the full
            client nav navigable (no 404s). Auth + HRMS module gated. The key
            allow-list is enforced inside ModuleComingSoon so unknown slugs
            bounce to /dashboard rather than rendering a generic teaser for
            something we never planned to ship. */}
        <Route
          path="/hrms/soon/:key"
          element={
            <RouteGuard anyOf={[P.HRMS_ESS_READ, P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_CHECKIN_SELF]}>
              <ModuleGate moduleKey="hrms"><ModuleComingSoon /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/settings"
          element={
            <RouteGuard anyOf={[P.PAYROLL_SETTINGS_READ]}>
              <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/components"
          element={
            <RouteGuard anyOf={[P.PAYROLL_COMPONENTS_READ]}>
              <ModuleGate moduleKey="payroll"><MasterModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/salary"
          element={
            <RouteGuard anyOf={[P.PAYROLL_STRUCTURE_READ_SELF]}>
              <ModuleGate moduleKey="payroll"><MySalaryStructure /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/payroll/runs"
          element={
            <RequirePermission code={P.PAYROLL_RUNS_READ}>
              <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
                <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
              </RouteGuard>
            </RequirePermission>
          }
        />
        <Route
          path="/hrms/payroll/runs/:id"
          element={
            <RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}>
              <ModuleGate moduleKey="payroll"><PayrollModule /></ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/me/payslips"
          element={
            <RouteGuard anyOf={[P.PAYROLL_PAYSLIP_READ_SELF]}>
              <ModuleGate moduleKey="payroll"><EmployeePayslips /></ModuleGate>
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
        <Route
          path="/hrms/letters/distributions"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_DISTRIBUTE, P.HRMS_LETTERS_READ]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <Distributions />
                </React.Suspense>
              </ModuleGate>
            </RouteGuard>
          }
        />
        <Route
          path="/hrms/letters/distributions/:jobId"
          element={
            <RouteGuard anyOf={[P.HRMS_LETTERS_DISTRIBUTE, P.HRMS_LETTERS_READ]}>
              <ModuleGate moduleKey="hrms">
                <React.Suspense fallback={null}>
                  <DistributionDetail />
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
        <Route path="/payroll" element={<Navigate to="/hrms/payroll-dashboard" replace />} />
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
  </>
)
registerRoutes(createRoutesFromChildren(ROUTE_TREE))

export default function App() {
  // 2026-09-10: wrap every route in an error boundary KEYED BY PATH.
  //
  // Before this, a render-phase throw anywhere unmounted the entire React
  // tree — the Attendance Analytics page crashed on a null employee_name and
  // the whole app went blank, staying blank through browser back and forward
  // because the root was gone. Only a hard reload recovered it, and nothing
  // on screen told the user that.
  //
  // Keying on pathname means navigating away remounts a fresh boundary, so a
  // broken page never sticks: the user leaves it and the app is healthy again.
  const location = useLocation()
  return (
    <RouteErrorBoundary resetKey={location.pathname} routeLabel={location.pathname}>
    <React.Suspense
      fallback={
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 200, color: '#64748b', fontSize: 14,
        }}>Loading…</div>
      }
    >
    <Routes>{ROUTE_TREE}</Routes>
    </React.Suspense>
    </RouteErrorBoundary>
  )
}
