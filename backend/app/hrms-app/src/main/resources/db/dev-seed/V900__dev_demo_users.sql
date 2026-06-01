-- ============================================================================
-- V900 - dev-only demo tenant + users  (NEVER load in production)
-- ============================================================================
-- This file lives at classpath:db/dev-seed/ and is loaded by Flyway ONLY
-- when the 'canonical' (smoke) profile is active. The canonical-prod profile
-- loads classpath:db/canonical/ only -- so these demo users do NOT exist on
-- any production deployment.
--
-- Demo accounts (password for both = Hrms@12345):
--   admin@unifiedtree.demo  -> SUPER_ADMIN (every permission)
--   reader@unifiedtree.demo -> EMPLOYEE (read-only set defined in V017)
--
-- Why V900: pushed out of the V001..V099 reserved canonical band so accidental
-- inclusion in production migration scans is immediately visible.
--
-- The bcrypt hash is cost 10; verified to match 'Hrms@12345' via
-- BCryptPasswordEncoder.matches() before being committed.
-- ============================================================================

-- Postgres needs the tenant id on the session to satisfy RLS on tenant-owned
-- tables. Migration runs in a single transaction, so SET LOCAL is sufficient.
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- 1. Demo tenant (platform.tenants is NOT RLS-isolated)
-- ---------------------------------------------------------------------------
INSERT INTO platform.tenants
    (id, subdomain, display_name, contact_email, status, plan_type)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'demo', 'UnifiedTree Demo',
     'admin@unifiedtree.demo', 'ACTIVE', 'ENTERPRISE')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Auth user_credentials
-- ---------------------------------------------------------------------------
-- bcrypt cost 10 hash of 'Hrms@12345'.
-- Verify with: BCryptPasswordEncoder().matches("Hrms@12345", "<hash>") -> true
INSERT INTO auth.user_credentials
    (id, tenant_id, email, mobile_number, password_hash, employee_id,
     is_active, is_biometric_enabled, failed_login_count,
     created_at, updated_at, created_by, updated_by, version)
VALUES
    -- Admin user
    ('11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'admin@unifiedtree.demo', '9999988881',
     '$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu',
     '11111111-1111-1111-1111-111111111111',
     TRUE, FALSE, 0,
     now(), now(), 'seed', 'seed', 0),
    -- Reader user (limited permission grant)
    ('22222222-2222-2222-2222-222222222222',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'reader@unifiedtree.demo', '9999988882',
     '$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu',
     '22222222-2222-2222-2222-222222222222',
     TRUE, FALSE, 0,
     now(), now(), 'seed', 'seed', 0)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Role grants (admin -> SUPER_ADMIN, reader -> a tenant-custom 'READER' role)
-- ---------------------------------------------------------------------------
-- The 5 system roles seeded in V004 use these UUIDs:
--   00000000-0000-0000-0000-000000000001  SUPER_ADMIN
--   00000000-0000-0000-0000-000000000002  HR_MANAGER
--   00000000-0000-0000-0000-000000000003  FINANCE_LEAD
--   00000000-0000-0000-0000-000000000004  EMPLOYEE
--   00000000-0000-0000-0000-000000000005  DEPT_MANAGER

INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111',
     '00000000-0000-0000-0000-000000000001',
     now(), '11111111-1111-1111-1111-111111111111'),
    -- reader gets EMPLOYEE (which we'll grant only hrms.employee.read to)
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '22222222-2222-2222-2222-222222222222',
     '00000000-0000-0000-0000-000000000004',
     now(), '11111111-1111-1111-1111-111111111111')
ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;

-- Role -> permission mappings for SUPER_ADMIN + EMPLOYEE are handled by
-- canonical V017 (loaded before this file). This dev seed only adds the
-- tenant, the user_credentials rows, and the user_role grants -- no
-- permission grants here.
