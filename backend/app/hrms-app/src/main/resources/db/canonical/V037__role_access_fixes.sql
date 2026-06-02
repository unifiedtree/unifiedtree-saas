-- ============================================================================
-- V037 - Role access fixes for role-based login routing
-- ----------------------------------------------------------------------------
-- Three gaps found during Prompt 8 implementation:
--
--   1. hrms.ess.read was never in the permission catalog. ESS dashboard
--      routes check this code; without it every non-SUPER_ADMIN role gets
--      403 from RouteGuard when accessing /hrms/ess or /me.
--
--   2. FINANCE_LEAD had only the 5 report codes (V026). They need
--      hrms.employee.read (directory read-only view) and settings.read.
--
--   3. DEPT_MANAGER lacked hrms.employee.read. They can already approve
--      leave and see team attendance, but the directory (team view) was
--      inaccessible because the permission was absent.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
-- ============================================================================

-- 1. Add missing permission codes to catalog
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.ess.read', 'Access employee self-service portal', 'hrms'),
    ('settings.read', 'View platform settings',              'settings')
ON CONFLICT (code) DO NOTHING;

-- 2. Grant hrms.ess.read to all roles that use the self-service dashboard
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000001', 'hrms.ess.read'),   -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000002', 'hrms.ess.read'),   -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'hrms.ess.read'),   -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000004', 'hrms.ess.read'),   -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000005', 'hrms.ess.read')    -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 3. Grant hrms.employee.read to FINANCE_LEAD (directory read-only view)
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000003', 'hrms.employee.read')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 4. Grant hrms.employee.read to DEPT_MANAGER (team directory view)
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000005', 'hrms.employee.read')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 5. Grant settings.read to FINANCE_LEAD
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000003', 'settings.read')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Verification
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt
      FROM rbac.role_permissions
     WHERE permission_code = 'hrms.ess.read';
    RAISE NOTICE 'hrms.ess.read grants: % (expect 5)', cnt;
END $$;
