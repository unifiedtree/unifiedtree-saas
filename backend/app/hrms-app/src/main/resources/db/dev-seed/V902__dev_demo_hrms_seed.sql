-- ============================================================================
-- V902 - Dev demo HRMS seed: one company + one employee per demo user
--
-- V900 created user_credentials rows with employee_id = user UUID but did NOT
-- create matching rows in org.companies / hrms.employees. AttendanceController
-- calls AttendanceContextResolver.resolve(employeeId) which throws
-- "Employee not found" (→ 500) when those rows are absent.
--
-- NEVER load in production (lives in db/dev-seed, loaded only by 'canonical'
-- smoke profile via application-canonical.yml).
-- ============================================================================

SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- 1. Demo company
-- ---------------------------------------------------------------------------
INSERT INTO org.companies
    (id, tenant_id, name, is_active, created_at, updated_at, created_by, updated_by, version)
VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'UnifiedTree Demo Corp', TRUE, now(), now(), 'seed', 'seed', 0)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Demo employees (IDs match user_credentials.employee_id from V900)
-- ---------------------------------------------------------------------------
INSERT INTO hrms.employees
    (id, tenant_id, employee_code, first_name, last_name, email,
     company_id, employment_type, employment_status, job_title, monthly_salary,
     date_of_joining,
     created_at, updated_at, created_by, updated_by, version)
VALUES
    -- Admin / SUPER_ADMIN user
    ('11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'EMP001', 'Admin', 'User', 'admin@unifiedtree.demo',
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'FULL_TIME', 'ACTIVE',
     'HR Manager', 150000.00, '2024-01-01',
     now(), now(), 'seed', 'seed', 0),
    -- Reader / EMPLOYEE user
    ('22222222-2222-2222-2222-222222222222',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'EMP002', 'Reader', 'User', 'reader@unifiedtree.demo',
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'FULL_TIME', 'ACTIVE',
     'Software Engineer', 100000.00, '2024-03-01',
     now(), now(), 'seed', 'seed', 0)
ON CONFLICT (id) DO NOTHING;
