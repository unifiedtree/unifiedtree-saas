-- V143.87: the built-in Dept Manager role no longer manages KPIs for the whole
-- company (hrms.kpi.manage).
--
-- Why. V090 (2026-08-11) granted hrms.kpi.manage to DEPT_MANAGER (...0005) so
-- the then-new KPI endpoints were not dead. The client decided on 2026-09-25
-- (V143.9, docs STATIC-UI-TO-BUILD 11.17) that department managers see only
-- their team and record progress on their team's KPIs with hrms.kpi.progress,
-- and "still can't create or drop KPIs". hrms.kpi.manage is described as
-- "Create, edit and remove KPIs for anyone in the company" (V143_17_1), and the
-- API treats it as company-wide, so every department manager was found on
-- 2026-10-05 seeing the whole company in Performance > People and Goals & KPIs,
-- opening anyone's performance page (ratings, reviews, goals, including the
-- workspace owner's) and being offered "Add company KPI" and "Add goal".
-- The API now also keeps reviews, ratings and the performance directory to the
-- team for anyone without hrms.performance.write (KpiAccessScope.forReviews),
-- so that part is closed even before this file is applied; this file closes
-- the company-wide KPI list and the KPI create / edit / drop.
--
-- Safety. Removes one grant from one built-in role (tenant_id IS NULL). Roles a
-- business made itself, and per-person grants, are untouched: if a business
-- copied Dept Manager into its own role it keeps whatever it chose. OWNER,
-- SUPER_ADMIN, ADMIN and HR_MANAGER keep hrms.kpi.manage, so
-- OwnerPermissionInvariantCheck is unaffected. DEPT_MANAGER keeps
-- hrms.kpi.progress (V143.9) and hrms.performance.read. People pick the change
-- up at their next sign-in or token refresh. No data is deleted.
--
-- Numbered 143.87 (reserved slot in 143.70-143.88). Idempotent: a re-run
-- deletes nothing.
-- Production has Flyway OFF: apply by hand, as the table owner.

DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE rp.role_id = r.id
   AND r.tenant_id IS NULL
   AND r.code = 'DEPT_MANAGER'
   AND rp.permission_code = 'hrms.kpi.manage';
