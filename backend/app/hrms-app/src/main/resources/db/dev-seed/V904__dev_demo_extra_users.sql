-- ============================================================================
-- V904 - Dev demo: 3 extra test users for role-based login testing
-- ----------------------------------------------------------------------------
-- Adds one user per remaining system role:
--   hrm@unifiedtree.demo  / Hrms@12345  → HR_MANAGER
--   mgr@unifiedtree.demo  / Hrms@12345  → DEPT_MANAGER
--   fin@unifiedtree.demo  / Hrms@12345  → FINANCE_LEAD
--
-- mgr is set as the reporting manager for reader (EMP002) so that
-- TeamDashboard direct-report queries have data.
--
-- UUIDs:
--   33333333-3333-3333-3333-333333333333  hrm
--   44444444-4444-4444-4444-444444444444  mgr
--   55555555-5555-5555-5555-555555555555  fin
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
-- ============================================================================

SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- 1. Auth credentials (same bcrypt hash as V900 — password: Hrms@12345)
-- ---------------------------------------------------------------------------
INSERT INTO auth.user_credentials
    (id, tenant_id, email, mobile_number, password_hash, employee_id,
     is_active, is_biometric_enabled, failed_login_count,
     created_at, updated_at, created_by, updated_by, version)
VALUES
    -- HR Manager
    ('33333333-3333-3333-3333-333333333333',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'hrm@unifiedtree.demo', '9999988883',
     '$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu',
     '33333333-3333-3333-3333-333333333333',
     TRUE, FALSE, 0,
     now(), now(), 'seed', 'seed', 0),
    -- Dept Manager
    ('44444444-4444-4444-4444-444444444444',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'mgr@unifiedtree.demo', '9999988884',
     '$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu',
     '44444444-4444-4444-4444-444444444444',
     TRUE, FALSE, 0,
     now(), now(), 'seed', 'seed', 0),
    -- Finance Lead
    ('55555555-5555-5555-5555-555555555555',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'fin@unifiedtree.demo', '9999988885',
     '$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu',
     '55555555-5555-5555-5555-555555555555',
     TRUE, FALSE, 0,
     now(), now(), 'seed', 'seed', 0)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Role grants
-- ---------------------------------------------------------------------------
INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
VALUES
    -- hrm → HR_MANAGER (00000000-...-0002)
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '33333333-3333-3333-3333-333333333333',
     '00000000-0000-0000-0000-000000000002',
     now(), '11111111-1111-1111-1111-111111111111'),
    -- mgr → DEPT_MANAGER (00000000-...-0005)
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '44444444-4444-4444-4444-444444444444',
     '00000000-0000-0000-0000-000000000005',
     now(), '11111111-1111-1111-1111-111111111111'),
    -- fin → FINANCE_LEAD (00000000-...-0003)
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '55555555-5555-5555-5555-555555555555',
     '00000000-0000-0000-0000-000000000003',
     now(), '11111111-1111-1111-1111-111111111111')
ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. HRMS employee rows (V902 schema)
-- ---------------------------------------------------------------------------
INSERT INTO hrms.employees
    (id, tenant_id, employee_code, first_name, last_name, email,
     company_id, employment_type, employment_status, job_title, monthly_salary,
     date_of_joining,
     created_at, updated_at, created_by, updated_by, version)
VALUES
    -- HR Manager employee
    ('33333333-3333-3333-3333-333333333333',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'EMP003', 'HR', 'Manager', 'hrm@unifiedtree.demo',
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'FULL_TIME', 'ACTIVE',
     'HR Manager', 120000.00, '2023-06-01',
     now(), now(), 'seed', 'seed', 0),
    -- Dept Manager employee (set as manager of reader EMP002)
    ('44444444-4444-4444-4444-444444444444',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'EMP004', 'Dept', 'Manager', 'mgr@unifiedtree.demo',
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'FULL_TIME', 'ACTIVE',
     'Engineering Manager', 130000.00, '2023-03-01',
     now(), now(), 'seed', 'seed', 0),
    -- Finance Lead employee
    ('55555555-5555-5555-5555-555555555555',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'EMP005', 'Finance', 'Lead', 'fin@unifiedtree.demo',
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'FULL_TIME', 'ACTIVE',
     'Finance Lead', 125000.00, '2023-09-01',
     now(), now(), 'seed', 'seed', 0)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Set mgr (EMP004) as the manager of reader (EMP002) so TeamDashboard
--    has at least one direct report to display.
-- ---------------------------------------------------------------------------
UPDATE hrms.employees
   SET reporting_manager_id = '44444444-4444-4444-4444-444444444444',
       updated_at = now()
 WHERE id = '22222222-2222-2222-2222-222222222222'
   AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
