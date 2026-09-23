# Current audit addendum - 2026-09-23

Read HRMS_IMPLEMENTATION_STATUS.md for the latest implementation and verification state. The original discovery table below is historical and is superseded where this addendum records a replacement.

## Live module inventory and data ownership

The 53 routes in apps/platform/test-results/recovery/live-browser.json were visited against real local APIs. Dynamic employee details were included for a seeded employee. This is not every possible dynamic record or role combination.

| Routes / area | Frontend | Backend/data | Authorization / scope | Current coverage |
|---|---|---|---|---|
| /dashboard | CompanyAdminDashboard, dashboard widgets | /v1/admin/dashboard/{stats,alerts,notices,performers,onboarding,hiring}; existing attendance/payroll/report APIs; hrms, hiring_mgmt, performance_mgmt, payroll, compliance_mgmt | Per-domain read permission; new summaries omit unauthorized fields; tenant RLS; team scope for pending approvals | Real data, API/browser checks |
| /hrms/employees, /hrms/employees/:id, /hrms/employees/import | Employees, EmployeeDetail, import | Workforce controllers; hrms.employees and related profile tables | hrms.employee.read/write; tenant/company scope | Route smoke, import/profile recovery tests; active-status drilldown added |
| /hrms/organization, /hrms/companies | OrgSetup, Companies | WorkforceController; org.companies/branches/departments/designations | org.company.read/write; org.geofence.write | Company/branch CRUD reused; geofence CRUD verified |
| /hrms/attendance, manual-entry, geofencing, muster-roll | Attendance, ManualAttendance, GeofenceZones, MusterRoll | AttendanceController/services; attendance.records, regularization_requests, shift policies | attendance.team.read, attendance.regularization.approve, self punch permissions; scoped employee resolver | Existing attendance tests and smoke; night-shift early-out fix tested |
| /hrms/shifts, /team | ShiftsAndOt, ShiftRoster, TeamSchedule, OvertimeApprovals | /v1/shifts, /v1/team/schedule, /v1/attendance/overtime; assignments, policies, records, overtime_decisions | Existing shift writes; attendance.team.read; attendance.overtime.approve; self excluded from approval scope | Real schedule and approval lifecycle tested |
| /hrms/ess | EssDashboard, AttendanceHistory, TimeEntries | /v1/ess/timesheets, existing attendance history; hrms.time_entries | attendance.checkin.self, JWT employee identity; no caller-supplied employee ID | CRUD/API/browser, ownership and duration limits |
| /hrms/leave | Leave | LeaveController; leave_mgmt requests/policies/balances | Existing self/L1/L2 permissions and scope | Apply/approve/cancel/balance restoration verified |
| /hrms/expenses | Expense | Expense stats/claims/reimbursements; expense_mgmt | Existing expense permissions | Live statistics, existing reimbursement workflow |
| /hrms/advances | Advance | AdvanceRecovery APIs and ledger tables | Existing request/approve/disburse permissions | Advance approval/disbursement/recovery tests |
| /hrms/fnf | FullAndFinal | Existing FNF APIs and settlement tables | hrms.fnf.read/process/approve; payroll gate | Existing recovery coverage, route smoke |
| /hrms/hiring | Hiring, OffersTab | HiringController; hiring_mgmt requisitions/candidates/offers | hiring.read/write/candidate.write, offer.read/write | Requisition/candidate/offer lifecycle, draft edit and protected PDF download verified; SMTP/PDF submission verified locally, remote provider delivery not certified |
| /hrms/performance | Performance and AdminCycles/AdminReviews/AdminKpis | Performance controllers; performance_mgmt cycles/reviews/goals/history | Existing performance permissions plus assigned reviewer/team checks | CRUD, progress, reviewer and out-of-team denial tested |
| /hrms/learning | Learning | LearningController, SkillService; learning_mgmt programs/enrollments/employee_skills | learning.read/write/enroll.self/skill.read | Enrollment, certification expiry and browser persistence |
| /hrms/compliance | Compliance, FilingCalendar, InspectorSessions | ComplianceController/InspectorAccess; compliance_mgmt items/filings/sessions | compliance.read/write/posh and inspector permissions; signed capability for anonymous calendar | Calendar, signed link, revoke, tamper, CSV export and session-scoped PDF sharing/download tests |
| /hrms/documents and /hrms/letters/* | DocumentVault, LetterTemplates, generated/distribution pages | Document and Letter controllers; document_mgmt and letter tables; R2Storage for file workflows | document self/admin and letters template/generation/read permissions | Real template reuse, metadata tests; external storage/delivery not certified |
| /hrms/onboarding and /hrms/onboarding/instances | Templates, Instances, AssetsTab | OnboardingController; hrms onboarding tables/assets | Self onboarding read is distinct from asset inventory; asset read or admin instance write | Assigned-task lifecycle and asset register/assign/return tests |
| /hrms/pli | Pli | /v1/pli/targets, awards; pli_mgmt | Existing PLI/target permissions | Persisted target UI and existing award workflows |
| /hrms/payroll-* and /hrms/payroll/*, /payroll | Payroll dashboard, structures, runs, bank history | Payroll controllers; payroll runs/payslips/components/batches | Payroll module gate plus existing read/manage/process/lock/payment permissions | Real overview/history; process/lock tests; alias fixed |
| /hrms/reports/*, workforce/attendance analytics | Report pages | Existing report/export controllers over HR/attendance/leave data | Domain report permissions, tenant scope | Live route/API reads; not every report boundary tested |
| /hrms/policies | Policies | Existing policy publication/acknowledgement APIs | policy.read/write/acknowledge.self | Draft/publish/employee acknowledgement tested |
| /hrms/integrations | Integrations | IntegrationController; integration_mgmt registry | integration.read/write | Real record CRUD; manual status only; provider adapters missing |
| /hrms/settings, work-time, payroll settings | Existing settings components | Existing settings/payroll configuration APIs | Existing domain settings permissions | Route smoke; not every configuration combination tested |
| /users, /roles, /settings | Workspace administration | Existing auth/RBAC/settings services | Existing workspace/platform permission separation | Owner route smoke; 64 endpoint checks across eight company roles; platform-admin surface separate |

## RBAC findings

Local database has nine role codes: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, DEPT_MANAGER, MANAGER, FINANCE_LEAD, EMPLOYEE, PLATFORM_SUPER_ADMIN. COMPANY_ADMIN and HR are compatibility aliases referenced in frontend buckets, not additional rows in this local database. No roles were removed or replaced.

Existing roles, rbac.permissions and rbac.role_permissions remain the authority. JWT authorities, PermissionChecker, frontend usePermission/RouteGuard/ModuleGate and PostgreSQL tenant RLS were extended rather than replaced. Job titles/designations remain separate org records. Scope is implemented in domain services; it is not safe to infer company-wide access from a read permission alone.

New project read/write and overtime-approval permissions extend that catalog. OWNER permission invariant passes on startup. TeamEmployeeScope reuses the existing admin/company, department-head and direct-report rules. Asset inventory no longer accepts an employee's ordinary onboarding-instance read permission. Custom role-only entry points for offers, skills, inspector access, assets and letter templates now have matching route/tab guards.

## New persistence and API contract inventory

| Migration | Tables/columns | Main constraints and behavior | API consumers |
|---|---|---|---|
| V130 | PLI targets, hiring offers, onboarding assets, inspector sessions | Tenant RLS, existing permission grants; entity/service validation and lifecycle checks | Pli, OffersTab, AssetsTab, InspectorSessions |
| V131 | employee_skills.expires_on | Expiry must not precede certification date | Learning certification issue/expiry fields |
| V132 | hrms.projects, hrms.project_tasks | Company/project FKs, status CHECKs, tenant/company indexes/RLS; project row lock protects close/task races | ProjectProductivity GET/POST projects/tasks, PUT statuses |
| V133 | hrms.time_entries | Employee FK, 1..1440 minutes CHECK, employee/date index/RLS; employee lock serializes daily-limit validation | GET dates, POST input, PUT/DELETE own ID at /v1/ess/timesheets |
| V134 | attendance.overtime_decisions | Composite FK to partitioned attendance record ID/date, unique record, status/minute CHECKs/RLS; record lock for decision | GET range/page and POST approve/reject at /v1/attendance/overtime |
| V136 | hrms.asset_allocations | Asset/employee FKs, date CHECK, one open allocation per asset, history index/RLS, latest allocation backfill | Asset history GET; assignment/return transactions append/update ledger |
| V135 | hrms.company_notices | Company FK, title/body length, timestamps/actor, archive/expiry, tenant/company index/RLS | GET company/page, POST/PUT validated notice, DELETE archive |

All new writes use backend transactions; frontend waits for successful API responses and invalidates relevant queries. No runtime feature uses localStorage as database persistence. Recovery fixtures live in the disposable local database; versioned migrations remain the schema source of truth.

## Additional regression findings

- Concurrent same-account login caused an optimistic credential update conflict; session-specific locked repository reads serialize login/refresh/session issuance without weakening authentication. Three parallel live sign-ins now pass.
- Auth record toString output could reveal credentials in debug logs; representations now redact secrets while retaining the wire contract.
- Asset history now has V136 persistence, latest-allocation backfill and a browser history view.

## Static/no-op findings resolved

- Runtime static dashboard performers, onboarding/hiring progress, payroll chart and productivity were replaced with persisted queries/workflows. Fabricated predictive AI text became factual operational follow-ups.
- Mock shift roster, ESS attendance-history tab, offer table, asset table, compliance calendar/inspector tab, certification cards, performance tabs, letter templates and salary overview now use APIs.
- Company/branch page controls and geofence now persist.
- Shared useToast used an unmounted context with a no-op default; it now uses the mounted Sonner notifier.
- /payroll no longer routes to a coming-soon page; dead Payroll export reuses the real dashboard.
- Integration toggling previously fabricated lastSyncedAt without contacting a provider. Removed that write and made registry status explicit. Actual provider connectors remain a gap.
- Old HrmsDashboard comments describing coming-soon tiles are historical/dead branch commentary; current company-admin component is CompanyAdminDashboard. Static enum choices and chart colors are configuration, not fabricated business records.

## Remaining acceptance and product gaps

See the explicit limits in HRMS_IMPLEMENTATION_STATUS.md. In particular: provider integrations, offer delivery, statutory inspector document access/OTP, overtime-to-payroll posting and comprehensive role/mobile/load coverage are not complete. Do not call this an exhaustive or production-certified audit.

---

## Historical discovery record

# HRMS Functionality Audit

Date: 2026-09-23
Workspace: C:\REACT\unifiedtree-saas

## Source of truth used

The workspace does not contain a `backend_requirements.md` file. A recursive search for that exact filename returned no result, so the pasted "Backend Requirements for HRMS UI Integration" content in the conversation is treated as the current requirements source. I cross-checked that list against the actual React and Spring Boot code before implementation.

## Confirmed production-facing static or mock HRMS gaps

| Area | Frontend file | Current finding | Backend/API status | Implementation need |
|---|---|---|---|---|
| Company Admin Dashboard | `apps/platform/src/modules/hrms/CompanyAdminDashboard.tsx` | Multiple panels are labelled mock: Top Performers, Onboarding Tracker, Hiring Progress, Projects & Productivity, Payroll Expense vs Budget, AI Insights. | No dedicated `/v1/admin/dashboard/*` controller found in the checked controller inventory. Some data can be aggregated from existing HRMS modules. | Add real dashboard stats/notices/alerts/summary endpoints or replace panels with real hooks from existing APIs. |
| Shifts & Overtime | `apps/platform/src/modules/hrms/attendance/ShiftsAndOt.tsx` | `ShiftRosterMock` is rendered in the HRMS attendance screen. | Attendance module has existing shift/attendance APIs, but the patched roster/overtime UI still uses static rows. | Wire roster/overtime to real attendance endpoints or add missing endpoints. |
| ESS Daily Track | `apps/platform/src/modules/hrms/ess/EssDashboard.tsx` | Requirements say today's time entries are static; code needs final inspection before patch. | Dedicated `/v1/ess/timesheets` not confirmed yet. | Add/wire time entries. |
| Team Attendance | `apps/platform/src/modules/hrms/TeamDashboard.tsx` | Requirements say team shift roster is static; code needs final inspection before patch. | Dedicated `/v1/team/schedule` not confirmed yet. | Add/wire manager schedule. |
| Expense Center | `apps/platform/src/modules/hrms/Expense.tsx` | Header cards are labelled static for pending approvals and to-be-reimbursed. | Claims/policies/reimbursement APIs exist; no `/v1/expense/dashboard-stats` hook in frontend. | Add dashboard stats endpoint/hook and replace static cards. |
| PLI Targets | `apps/platform/src/modules/hrms/Pli.tsx` | `PliTargetsStatic` renders static target rows. | Existing backend only covers PLI awards: `/v1/pli/awards`, `/v1/pli/my`, decision, pay. | Add PLI target table/entity/repository/service/controller/hook and replace static tab. |
| Bank Disbursement History | `apps/platform/src/modules/hrms/payroll/BankDisbursement.tsx` | Historical batches block is marked Phase 5 Static. | Payroll disbursement APIs exist but history endpoint requested by UI is missing or unwired. | Add/wire `/v1/payroll/disbursement/history`. |
| Compliance Inspector | `apps/platform/src/modules/hrms/Compliance.tsx` | `InspectorTabStatic` renders static inspector session and OTP action. | Existing backend has compliance items, statutory filings, POSH. No inspector sessions endpoints. | Add inspector session table/entity/API and OTP/link action. |
| Compliance Calendar Events | `apps/platform/src/modules/hrms/Compliance.tsx` | Calendar card is labelled static. | Existing compliance item/filing data can back real events; no dedicated `/v1/compliance/calendar-events`. | Add calendar-events endpoint or render events from real items/filings. |
| Hiring Offer Management | `apps/platform/src/modules/hrms/Hiring.tsx` | `OffersTabStatic` renders a static offer row. | Existing backend has requisitions and candidates; no offer entity/API. | Add offer table/entity/API/hook and replace static tab. |
| Onboarding Assets | `apps/platform/src/modules/hrms/onboarding/Instances.tsx` | `AssetsTabStatic` renders a static asset row. | Existing backend has onboarding templates/instances/tasks. No asset allocation API. | Add asset allocation table/entity/API/hook and replace static tab. |
| Employee Vault Letters | `apps/platform/src/modules/hrms/DocumentVault.tsx` | `LettersTabStatic` renders static letter templates/contracts. | Document/vault backend needs verification; requested `/v1/documents/letters-templates` not confirmed. | Add/wire letter templates. |
| Performance KPIs/Appraisals | `apps/platform/src/modules/hrms/Performance.tsx` | KPI Tracking section is labelled static. | Performance backend exists in prior migration work but needs full frontend/backend contract check. | Replace static KPIs with real performance KPI/appraisal endpoints. |
| Learning Certifications & Skills | `apps/platform/src/modules/hrms/Learning.tsx` | Requirements say certifications/skills are pending backend implementation. | Learning backend has at least skill permission migration but needs verification. | Add/wire certification and skill tracking. |

## Backend extension strategy

The project already has tenant-aware schemas, RLS, module-specific Spring Boot modules, and RBAC permissions seeded through Flyway-style canonical SQL migrations. Implementation should extend that pattern instead of creating a second authorization/data model.

The next migration version after the currently present canonical files is `V130`. New persistent HRMS tables should be tenant-scoped, RLS-enabled, indexed by tenant/company/status/date as appropriate, and granted to the runtime database roles using the existing guarded `hrms_app` / `app_user` pattern.

## First implementation batch

The fastest safe batch is the exact static UI created by the reference integration and backed by clear module ownership:

1. Expense dashboard stats, because claims already exist and only aggregation is needed.
2. PLI targets, because awards already exist and a small target table/API completes the PLI tab.
3. Hiring offers, because candidates already have OFFER/HIRED stages and offers can link to requisitions/candidates.
4. Onboarding assets, because onboarding instances exist and assets need a simple allocation lifecycle.
5. Compliance inspector sessions and compliance calendar events, because compliance items/filings already exist and inspector sessions are isolated.

The remaining batch after that is payroll disbursement history, shift/overtime roster, ESS timesheets, team schedule, document letter templates, performance KPIs, and learning certifications/skills.
