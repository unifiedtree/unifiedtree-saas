-- V143.18: the built-in ADMIN role becomes a real company admin.
--
-- ADMIN held 59 permissions, fewer than HR_MANAGER (136): an "Admin" could not
-- approve leave, run payroll, read documents, manage hiring, reports or settings.
-- The client's model is levels: OWNER > ADMIN > HR / Finance > Manager > Employee.
-- ADMIN now holds everything OWNER holds EXCEPT two owner-only powers:
--   * workspace.modules.buy  (buying modules)
--   * tenant.settings.write  (danger zone: workspace-wide destructive settings)
-- and never platform.*. ADMIN already had workspace.billing.manage (the design
-- treats Owner, Super Admin and Company Admin as billing admins); nothing is removed.
--
-- It copies OWNER's grants as they stand when this runs, so later migrations
-- that add permissions re-run the same statement. Idempotent.

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT admin_role.id, rp.permission_code
  FROM rbac.role_permissions rp
  JOIN rbac.roles owner_role ON owner_role.id = rp.role_id
                            AND owner_role.code = 'OWNER'
                            AND owner_role.tenant_id IS NULL
 CROSS JOIN (SELECT id FROM rbac.roles WHERE code = 'ADMIN' AND tenant_id IS NULL) admin_role
 WHERE rp.permission_code NOT IN ('workspace.modules.buy', 'tenant.settings.write')
   AND rp.permission_code NOT LIKE 'platform.%'
ON CONFLICT DO NOTHING;

UPDATE rbac.roles
   SET display_name = 'Admin',
       description  = 'Company admin: everything the owner can do except buying modules and resetting or deleting the workspace.'
 WHERE code = 'ADMIN' AND tenant_id IS NULL;
