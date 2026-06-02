-- ============================================================================
-- V043 - Workspace Users & Access: add workspace.users.read (Prompt 10)
-- ----------------------------------------------------------------------------
-- The /users (Workspace Users & Access) page is ADMIN-ONLY.
--   workspace.users.read   -> gates GET /v1/workspace/users + assignable-roles
--   workspace.users.manage -> gates invite / assign-role / remove-role
--
-- 'workspace.users.manage' ALREADY exists (V035) and is granted to OWNER (010)
-- and ADMIN (011) via the V035 fan-out. Only 'workspace.users.read' is new.
-- This migration:
--   (a) adds 'workspace.users.read',
--   (b) ensures BOTH codes are granted to SUPER_ADMIN (001), OWNER (010),
--       ADMIN (011). SUPER_ADMIN had neither before; OWNER/ADMIN had only
--       .manage. ON CONFLICT DO NOTHING makes it idempotent.
--
-- HR_MANAGER (002) and EMPLOYEE (004) are intentionally NOT granted either
-- code: the workspace user-management surface is admin-only.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('workspace.users.read',
     'View workspace users',
     'workspace',
     'View the Workspace Users & Access page (admin-only).'),
    ('workspace.users.manage',
     'Invite users and manage roles',
     'workspace',
     'Invite users, assign/remove roles, and manage workspace access.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000001', 'workspace.users.read'),   -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'workspace.users.manage'),
    ('00000000-0000-0000-0000-000000000010', 'workspace.users.read'),   -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'workspace.users.manage'),
    ('00000000-0000-0000-0000-000000000011', 'workspace.users.read'),   -- ADMIN
    ('00000000-0000-0000-0000-000000000011', 'workspace.users.manage')
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
DECLARE read_cnt INT; manage_cnt INT;
BEGIN
    SELECT count(*) INTO read_cnt   FROM rbac.role_permissions
     WHERE permission_code='workspace.users.read'
       AND role_id IN ('00000000-0000-0000-0000-000000000001',
                       '00000000-0000-0000-0000-000000000010',
                       '00000000-0000-0000-0000-000000000011');
    SELECT count(*) INTO manage_cnt FROM rbac.role_permissions
     WHERE permission_code='workspace.users.manage'
       AND role_id IN ('00000000-0000-0000-0000-000000000001',
                       '00000000-0000-0000-0000-000000000010',
                       '00000000-0000-0000-0000-000000000011');
    RAISE NOTICE 'workspace.users.read grants (001,010,011): % (expect 3)',  read_cnt;
    RAISE NOTICE 'workspace.users.manage grants (001,010,011): % (expect 3)', manage_cnt;
END $$;
