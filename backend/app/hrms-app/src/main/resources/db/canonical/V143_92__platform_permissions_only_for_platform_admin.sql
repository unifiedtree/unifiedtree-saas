-- V143.92: platform.* permissions belong to the platform admin only.
--
-- Why. V019 (lines 45-49) gave the built-in SUPER_ADMIN role platform.tenant.read,
-- .approve and .reject "to keep SUPER_ADMIN a true superset", and V017 had
-- already copied platform.admin onto it from the whole catalogue. SUPER_ADMIN is
-- a workspace role: every business owner gets it at sign-up (SaasWriter). So any
-- business owner could call GET /v1/platform/tenant-requests and read every
-- other business's name, contact email and phone, and approve or reject other
-- businesses' sign-ups. platform.* is for UnifiedTree's own operators, who hold
-- the PLATFORM_SUPER_ADMIN role in the platform tenant
-- (00000000-0000-0000-0000-000000000000).
--
-- What it does.
--   1. Makes sure SUPER_ADMIN holds the workspace permission on the left of every
--      "... or hasAuthority('platform.admin')" guard (roles, permissions catalogue,
--      users, companies, branches, departments, designations, contractors), so
--      losing platform.admin closes nothing a workspace uses. Production's role
--      grants have drifted from the migrations before (see V143_70), so this is
--      granted again rather than assumed. OWNER and ADMIN already hold all eight.
--   2. Removes platform.* from every role except the built-in PLATFORM_SUPER_ADMIN:
--      the built-in SUPER_ADMIN, and any role a business made by copying it.
--   3. Removes per-person overrides of platform.* outside the platform tenant
--      (the API has refused to create them since W1h; this clears any older row).
--   4. Removes the PLATFORM_SUPER_ADMIN role from anyone outside the platform
--      tenant (nothing in a workspace can give it; this clears any older row).
--
-- Safety. OWNER is untouched (OwnerPermissionInvariantCheck only checks OWNER and
-- ignores module 'platform'). PLATFORM_SUPER_ADMIN keeps its four grants. No
-- workspace data is deleted. People pick the change up at their next sign-in or
-- token refresh; the backend's platform endpoints also refuse a workspace token
-- outright (PlatformAdminAccess), so a token issued before this ran is no use.
-- A future migration that copies the whole catalogue onto SUPER_ADMIN (as V017
-- did) must exclude module 'platform', as V035 and V064 do for OWNER.
--
-- Numbered 143.92 (reserved). Idempotent: a re-run grants and deletes nothing.
-- Production has Flyway OFF: apply by hand, as the table owner, inside
-- BEGIN; ... COMMIT; and run the before/after checks from the fix report.

-- 1. SUPER_ADMIN keeps every workspace permission the platform.admin guards pair with.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
  JOIN rbac.permissions p
    ON p.code IN ('rbac.role.write',
                  'rbac.access.manage-overrides',
                  'workspace.users.read',
                  'workspace.users.manage',
                  'org.company.read',
                  'hrms.department.read',
                  'hrms.designation.read',
                  'hrms.contractor.read')
 WHERE r.tenant_id IS NULL
   AND r.code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 2. platform.* only on the built-in PLATFORM_SUPER_ADMIN role.
DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE rp.role_id = r.id
   AND rp.permission_code LIKE 'platform.%'
   AND NOT (r.tenant_id IS NULL AND r.code = 'PLATFORM_SUPER_ADMIN');

-- 3. No per-person platform.* override inside a workspace.
DELETE FROM rbac.user_permission_overrides
 WHERE permission_code LIKE 'platform.%'
   AND tenant_id <> '00000000-0000-0000-0000-000000000000';

-- 4. Nobody in a workspace holds the platform admin role.
DELETE FROM rbac.user_roles ur
 USING rbac.roles r
 WHERE ur.role_id = r.id
   AND r.tenant_id IS NULL
   AND r.code = 'PLATFORM_SUPER_ADMIN'
   AND ur.tenant_id <> '00000000-0000-0000-0000-000000000000';

-- Stop here (and roll back) if a built-in workspace role still holds platform.*.
DO $$
DECLARE
    left_over integer;
BEGIN
    SELECT count(*) INTO left_over
      FROM rbac.role_permissions rp
      JOIN rbac.roles r ON r.id = rp.role_id
     WHERE rp.permission_code LIKE 'platform.%'
       AND r.tenant_id IS NULL
       AND r.code <> 'PLATFORM_SUPER_ADMIN';
    IF left_over > 0 THEN
        RAISE EXCEPTION 'V143_92: % platform.* grants are still on built-in workspace roles', left_over;
    END IF;
END $$;
