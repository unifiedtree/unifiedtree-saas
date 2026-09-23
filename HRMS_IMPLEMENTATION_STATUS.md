# HRMS Implementation Status

Date: 2026-09-23

## Current status

Audit started from the pasted Backend Requirements for HRMS UI Integration. The physical `backend_requirements.md` file is absent from the workspace, so this status file records the pasted requirements plus repo findings.

## Completed in this pass

- Added `V130__hrms_static_ui_backend_foundations.sql` for PLI targets, hiring offers, onboarding assets, and compliance inspector sessions.
- Added compiled backend support for:
  - `GET/POST/PUT /v1/pli/targets`
  - `GET/POST/POST-status /v1/hiring/offers`
  - `GET /v1/expense/dashboard-stats`
  - `GET/POST/assign/return /v1/onboarding/assets`
  - `GET/POST/revoke /v1/compliance/inspector-sessions`
  - `GET /v1/compliance/calendar-events`
- Replaced frontend static PLI monthly targets with real API hooks and table/create form.
- Replaced frontend static expense dashboard cards with real API-driven stats.
- Confirmed the production-facing static/mock sections in the HRMS React pages.
- Confirmed the existing backend already has real support for several adjacent domains:
  - Hiring requisitions and candidates.
  - PLI awards and employee self-view.
  - Compliance items, statutory filings, and POSH register.
  - Expense claims, approvals, policies, and reimbursement actions.
  - Onboarding templates, instances, and tasks.
- Confirmed new backend work is still required for several patched frontend sections.

## In progress

- Replacing the remaining static HRMS UI sections with the new real hooks/components. Backend for the first batch is compiled; frontend wiring is complete for expense stats and PLI targets, still pending for hiring offers, onboarding assets, and compliance inspector/calendar views.

## Not yet complete

- `/v1/admin/dashboard/stats`, `/v1/admin/dashboard/notices`, `/v1/admin/dashboard/alerts`
- Attendance overtime approvals and shift roster replacement.
- ESS timesheets/time entries.
- Manager team schedule.
- Payroll disbursement history.
- Document letter templates/contracts.
- Performance KPI/appraisal backend/frontend wiring.
- Learning certification/skill backend/frontend wiring.
- Frontend replacement still pending for hiring offers, onboarding assets, compliance inspector sessions, and compliance calendar events.
- Browser/API smoke tests against the running local backend after applying V130 migration.

## Operating rule for continuation

Do not remove the redesigned UI. Replace static data with real hooks, real endpoints, database migrations, and RBAC permissions while preserving the visual direction already added to the platform UI.


## Verification completed

- Backend compile: `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot; mvn -pl app/hrms-api -am -DskipTests compile` from `backend/` passed.
- Frontend build: `pnpm --filter platform build` passed.
