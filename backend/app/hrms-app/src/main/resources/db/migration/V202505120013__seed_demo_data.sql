-- Demo seed data for local development and smoke testing.
-- All inserts are idempotent — safe to run multiple times.

DO $$
DECLARE
    v_tenant_id   UUID;
    v_company_id  UUID;
    v_branch_id   UUID;
    v_dept_id     UUID;
    v_user_id     UUID;
    v_employee_id UUID;
    v_lt_annual   UUID;
    v_lt_sick     UUID;
    v_lt_casual   UUID;
BEGIN

    -- ── Tenant ────────────────────────────────────────────────────────────────
    -- Use a fixed, well-known UUID so every dev environment gets the same IDs.
    v_tenant_id := 'aaaaaaaa-0000-0000-0000-000000000001'::UUID;

    -- ── Company ───────────────────────────────────────────────────────────────
    INSERT INTO companies (id, tenant_id, name, domain, subscription_tier,
                           max_employees, industry, country, timezone, currency, is_active)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::UUID,
            v_tenant_id, 'Demo Corp', 'demo-corp', 'ENTERPRISE',
            500, 'Technology', 'India', 'Asia/Kolkata', 'INR', true)
    ON CONFLICT (id) DO NOTHING;

    v_company_id := 'bbbbbbbb-0000-0000-0000-000000000001'::UUID;

    -- ── Branch (Bangalore HQ — 50 km geofence for easy local testing) ─────────
    INSERT INTO branches (id, tenant_id, company_id, name, code, city, country,
                          latitude, longitude, geo_fence_radius_meters,
                          is_headquarters, is_active)
    VALUES ('cccccccc-0000-0000-0000-000000000001'::UUID,
            v_tenant_id, v_company_id, 'Bangalore HQ', 'BLR-HQ', 'Bangalore', 'India',
            12.9716, 77.5946, 50000,
            true, true)
    ON CONFLICT (id) DO NOTHING;

    v_branch_id := 'cccccccc-0000-0000-0000-000000000001'::UUID;

    -- ── Department ────────────────────────────────────────────────────────────
    INSERT INTO departments (id, tenant_id, company_id, name, code, is_active)
    VALUES ('dddddddd-0000-0000-0000-000000000001'::UUID,
            v_tenant_id, v_company_id, 'Engineering', 'ENG', true)
    ON CONFLICT (id) DO NOTHING;

    v_dept_id := 'dddddddd-0000-0000-0000-000000000001'::UUID;

    -- ── Admin user credential ─────────────────────────────────────────────────
    -- Password: Admin@123  (bcrypt cost 10)
    INSERT INTO user_credentials (id, tenant_id, email, mobile_number, password_hash, is_active, is_biometric_enabled)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001'::UUID,
            v_tenant_id,
            'admin@demo-corp.com',
            '9999999999',
            '$2a$10$mY8mTIEuqWEQyJIUKzsuX.ipY68JolYl1xQZjMxvg8e8LObYNZU96',
            true,
            true)
    ON CONFLICT (id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        mobile_number = EXCLUDED.mobile_number,
        is_biometric_enabled = EXCLUDED.is_biometric_enabled;

    v_user_id := 'eeeeeeee-0000-0000-0000-000000000001'::UUID;

    -- Grant all roles to the demo admin for easy testing
    INSERT INTO user_roles (user_credential_id, role)
    VALUES (v_user_id, 'COMPANY_ADMIN'),
           (v_user_id, 'HR_MANAGER'),
           (v_user_id, 'DEPT_MANAGER'),
           (v_user_id, 'EMPLOYEE')
    ON CONFLICT DO NOTHING;

    -- ── Employee — same UUID as user_credentials so JWT sub works as employeeId ──
    v_employee_id := v_user_id;

    INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name,
                           email, phone, company_id, department_id, branch_id,
                           employment_type, employment_status, date_of_joining,
                           job_title, is_face_enrolled)
    VALUES (v_employee_id, v_tenant_id, 'EMP001', 'Demo', 'Admin',
            'admin@demo-corp.com', '9999999999', v_company_id, v_dept_id, v_branch_id,
            'FULL_TIME', 'ACTIVE', CURRENT_DATE,
            'Platform Administrator', false)
    ON CONFLICT (id) DO NOTHING;

    -- Link user_credentials → employee
    UPDATE user_credentials
    SET employee_id = v_employee_id
    WHERE id = v_user_id AND employee_id IS NULL;

    -- ── Shift policy ──────────────────────────────────────────────────────────
    INSERT INTO shift_policies (id, tenant_id, company_id, name, shift_type,
                                start_time, end_time, grace_period_minutes,
                                working_hours_per_day, is_active)
    VALUES ('ffffffff-0000-0000-0000-000000000001'::UUID,
            v_tenant_id, v_company_id, 'Standard 9-6', 'FIXED',
            '09:00', '18:00', 30, 8.0, true)
    ON CONFLICT (id) DO NOTHING;

    -- ── Leave types ───────────────────────────────────────────────────────────
    INSERT INTO leave_types (id, tenant_id, company_id, name, code,
                             annual_entitlement, is_paid_leave, is_active)
    VALUES
        ('11111111-1111-0000-0000-000000000001'::UUID,
         v_tenant_id, v_company_id, 'Annual Leave', 'ANNUAL', 21, true, true),
        ('22222222-2222-0000-0000-000000000001'::UUID,
         v_tenant_id, v_company_id, 'Sick Leave', 'SICK', 12, true, true),
        ('33333333-3333-0000-0000-000000000001'::UUID,
         v_tenant_id, v_company_id, 'Casual Leave', 'CASUAL', 6, true, true)
    ON CONFLICT (id) DO NOTHING;

    v_lt_annual := '11111111-1111-0000-0000-000000000001'::UUID;
    v_lt_sick   := '22222222-2222-0000-0000-000000000001'::UUID;
    v_lt_casual := '33333333-3333-0000-0000-000000000001'::UUID;

    -- ── Leave balances for demo employee ──────────────────────────────────────
    INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id,
                                year, total_entitlement, used, pending)
    VALUES
        (gen_random_uuid(), v_tenant_id, v_employee_id, v_lt_annual,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT, 21, 3, 0),
        (gen_random_uuid(), v_tenant_id, v_employee_id, v_lt_sick,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT, 12, 1, 0),
        (gen_random_uuid(), v_tenant_id, v_employee_id, v_lt_casual,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT, 6, 0, 0)
    ON CONFLICT ON CONSTRAINT uq_leave_balance DO NOTHING;

END $$;
