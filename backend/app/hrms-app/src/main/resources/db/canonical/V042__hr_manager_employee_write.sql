-- ============================================================================
-- V042 - Grant employee create/edit/delete to HR_MANAGER
-- ----------------------------------------------------------------------------
-- Gap found in the browser: HR_MANAGER had hrms.employee.read (V038) but NOT
-- hrms.employee.write, so the "Add Employee" button was hidden and the
-- WorkforceController.createEmployee endpoint (@PreAuthorize hrms.employee.write)
-- would 403. Creating/editing/removing employees is the HR Manager's core job.
--
-- SUPER_ADMIN already holds these via the V017 catalogue fan-out.
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'hrms.employee.write'),   -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.employee.delete')   -- HR_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM rbac.role_permissions
     WHERE role_id='00000000-0000-0000-0000-000000000002'
       AND permission_code IN ('hrms.employee.write','hrms.employee.delete');
    RAISE NOTICE 'HR_MANAGER employee write/delete grants: % (expect 2)', c;
END $$;
