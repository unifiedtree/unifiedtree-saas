-- V143.85: the built-in manager roles (DEPT_MANAGER and MANAGER) may confirm
-- or extend probation for people in their own team (hrms.probation.team.decide).
--
-- Why. V143.55 (Release 2) added hrms.probation.team.decide and, following the
-- redesign's DECISIONS 15, granted it only to OWNER and SUPER_ADMIN; V143.67
-- added ADMIN. So a standard Manager or Dept Manager saw their team's
-- probation end dates on My team (website) and Team today (app) but got no
-- Confirm or Extend, and HR had to do every one. The owner decided on
-- 2026-10-05 that a manager confirms or extends probation for their own team,
-- on the website and in the app, the same way. Both already call the same
-- endpoints (POST /v1/team/probation/{employeeId}/confirm | extend) behind this
-- one permission, so granting it is the whole change.
--
-- Safety. Adds one existing permission to two built-in roles (tenant_id IS
-- NULL). Roles a business made itself, and per-person grants, are untouched:
-- if a business copied Manager into its own role it keeps whatever it chose.
-- The API still allows a decision only for someone in the caller's team (the
-- My team rule: the departments they head, else their direct reports, never
-- themself; managers do not hold attendance.workforce.admin, so this is never
-- the whole company) who is on probation; HR and the employee are told and
-- every decision is audited. Nothing is removed, so
-- OwnerPermissionInvariantCheck is unaffected. People pick the change up at
-- their next sign-in or token refresh. No data is changed.
--
-- Numbered 143.85 (reserved slot in 143.70-143.88). Idempotent: a re-run adds
-- nothing (ON CONFLICT DO NOTHING).
-- Production has Flyway OFF: apply by hand, as the table owner.

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.probation.team.decide'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('DEPT_MANAGER', 'MANAGER')
ON CONFLICT DO NOTHING;
