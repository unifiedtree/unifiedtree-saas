-- ============================================================================
-- V019 - SaaS portal platform admin: role + permissions
-- ============================================================================
-- Adds the PLATFORM_SUPER_ADMIN system role and the platform.tenant.*
-- permission codes used by the new com.unifiedtree.saas controllers
-- (PlatformSaasController).
--
-- The platform admin is a user in the special "platform tenant"
-- (id = 00000000-0000-0000-0000-000000000000). Bootstrap is env-driven via
-- com.unifiedtree.saas.bootstrap.PlatformAdminBootstrap on first deploy.
-- ============================================================================

-- New permission codes
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('platform.tenant.read',    'List and read tenant requests',      'platform'),
    ('platform.tenant.approve', 'Approve tenant signup + modules',    'platform'),
    ('platform.tenant.reject',  'Reject tenant signup',               'platform')
ON CONFLICT (code) DO NOTHING;

-- New system role PLATFORM_SUPER_ADMIN. tenant_id IS NULL marks it system.
INSERT INTO rbac.roles
    (id, tenant_id, code, display_name, description, is_system, is_default_for_new_users)
VALUES
    ('00000000-0000-0000-0000-000000000006',
     NULL,
     'PLATFORM_SUPER_ADMIN',
     'Platform Super Admin',
     'UnifiedTree platform-level administrator. Approves tenants and manages module activation.',
     TRUE, FALSE)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Grant platform.* + tenant approval permissions to PLATFORM_SUPER_ADMIN.
DELETE FROM rbac.role_permissions
 WHERE role_id = '00000000-0000-0000-0000-000000000006';

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000006', 'platform.tenant.read'),
    ('00000000-0000-0000-0000-000000000006', 'platform.tenant.approve'),
    ('00000000-0000-0000-0000-000000000006', 'platform.tenant.reject'),
    ('00000000-0000-0000-0000-000000000006', 'platform.admin');

-- Keep SUPER_ADMIN role a true superset: ensure the new permissions also
-- grant for SUPER_ADMIN. V017 wiped + re-seeded SUPER_ADMIN from the catalog,
-- so we just re-add the new codes (idempotent).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code IN ('platform.tenant.read','platform.tenant.approve','platform.tenant.reject')
ON CONFLICT (role_id, permission_code) DO NOTHING;
