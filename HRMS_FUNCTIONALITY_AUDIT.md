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
