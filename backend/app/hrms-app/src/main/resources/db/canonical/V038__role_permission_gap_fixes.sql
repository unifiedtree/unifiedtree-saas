-- ============================================================================
-- V038 - Close role-permission gaps found during role-based login testing
-- ----------------------------------------------------------------------------
-- Gaps confirmed by clicking every sidebar item for all 5 roles:
--
--   HR_MANAGER:
--     - Missing hrms.employee.read → RouteGuard blocks /hrms/employees
--     - Missing hrms.department.read → RouteGuard blocks /hrms/organization
--     - Missing hrms.department.write / hrms.designation.write / org.company.read
--       → can navigate but can't mutate org data
--
--   EMPLOYEE:
--     - Missing hrms.letters.read.self → RouteGuard blocks /hrms/letters/generated
--     - Missing hrms.onboarding.task.complete → RouteGuard blocks /hrms/onboarding/instances
--
--   (FINANCE_LEAD directory 403 is fixed in WorkforceController / SettingsController
--    by adding hasAuthority() as an alternative — no new grants needed here because
--    FINANCE_LEAD already has hrms.employee.read and settings.read from V037.)
--
-- All inserts are idempotent: ON CONFLICT (role_id, permission_code) DO NOTHING.
-- ============================================================================

-- ── HR_MANAGER: core employee + org permissions ────────────────────────────

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- Employee directory read (satisfies /hrms/employees RouteGuard)
    ('00000000-0000-0000-0000-000000000002', 'hrms.employee.read'),
    -- Org structure read (satisfies /hrms/organization RouteGuard)
    ('00000000-0000-0000-0000-000000000002', 'hrms.department.read'),
    -- Org structure write (HR manages departments / designations / branches)
    ('00000000-0000-0000-0000-000000000002', 'hrms.department.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.designation.write'),
    ('00000000-0000-0000-0000-000000000002', 'org.company.read'),
    ('00000000-0000-0000-0000-000000000002', 'org.company.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── EMPLOYEE: self-service permissions ────────────────────────────────────

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- Own letters (satisfies /hrms/letters/generated RouteGuard)
    ('00000000-0000-0000-0000-000000000004', 'hrms.letters.read.self'),
    -- Own onboarding tasks (satisfies /hrms/onboarding/instances RouteGuard)
    ('00000000-0000-0000-0000-000000000004', 'hrms.onboarding.task.complete'),
    ('00000000-0000-0000-0000-000000000004', 'hrms.onboarding.instance.read')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Verification
DO $$
DECLARE
    hrm_emp   INT; hrm_dept INT;
    emp_ltrs  INT; emp_onb  INT;
BEGIN
    SELECT count(*) INTO hrm_emp  FROM rbac.role_permissions WHERE role_id='00000000-0000-0000-0000-000000000002' AND permission_code='hrms.employee.read';
    SELECT count(*) INTO hrm_dept FROM rbac.role_permissions WHERE role_id='00000000-0000-0000-0000-000000000002' AND permission_code='hrms.department.read';
    SELECT count(*) INTO emp_ltrs FROM rbac.role_permissions WHERE role_id='00000000-0000-0000-0000-000000000004' AND permission_code='hrms.letters.read.self';
    SELECT count(*) INTO emp_onb  FROM rbac.role_permissions WHERE role_id='00000000-0000-0000-0000-000000000004' AND permission_code='hrms.onboarding.task.complete';
    RAISE NOTICE 'HR_MANAGER hrms.employee.read: % (expect 1)', hrm_emp;
    RAISE NOTICE 'HR_MANAGER hrms.department.read: % (expect 1)', hrm_dept;
    RAISE NOTICE 'EMPLOYEE hrms.letters.read.self: % (expect 1)', emp_ltrs;
    RAISE NOTICE 'EMPLOYEE hrms.onboarding.task.complete: % (expect 1)', emp_onb;
END $$;
