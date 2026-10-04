-- V143.70: restore the company-list read permission for the built-in Employee,
-- Dept Manager, Manager and Finance Lead roles.
--
-- Why. V065 (dead permission resolution) grants org.company.read to eight
-- built-in roles, and no later migration removes it. Production was found on
-- 2026-10-04 without it on four of them: EMPLOYEE (...0004), DEPT_MANAGER
-- (...0005), MANAGER (...0012) and FINANCE_LEAD (...0003). Production data had
-- drifted from the migrations, which is why employees and managers got a 403 from
-- GET /v1/hrms/companies on every Leave and Shifts page load. The web stopped
-- needing it (01c73263), but production should hold what every database built
-- from the migrations holds; otherwise a later Flyway baseline would record a
-- state production does not have.
--
-- Safety. Re-applies exactly V065's grant for those four roles and adds nothing
-- new: on a database built from the migrations it is a no-op.
-- org.company.read is LOW risk ("See the companies in this workspace and their
-- branches", V143_17_1). Built-in roles only (tenant_id IS NULL); roles a
-- business made itself are untouched. People pick it up at their next sign-in.
--
-- Numbered 143.70: 143.69 is the latest; 143.70 to 143.88 are reserved for the
-- lead's side (the teammate's migrations start at 144.1). Idempotent.
-- Production has Flyway OFF: apply by hand, as the table owner.

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'org.company.read'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('EMPLOYEE', 'DEPT_MANAGER', 'MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;
