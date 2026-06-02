-- ============================================================================
-- V049 - Payroll run lifecycle permissions + role grants (Prompt 13a)
-- ----------------------------------------------------------------------------
-- Adds the run-execution capability codes on top of V048's payroll catalog:
--   payroll.runs.manage       -> create / process a run (DRAFT -> PROCESSING)
--   payroll.runs.lock         -> lock or reopen a run   (PROCESSING -> LOCKED)
--   payroll.payslip.read.self -> employee views own payslip (locked runs only)
-- SUPER_ADMIN + FINANCE_LEAD: manage + lock (they already hold payroll.runs.read
-- from V048). EMPLOYEE: own payslip only. HR_MANAGER keeps read-only.
-- No schema change — the V046 runs/payslip_lines/run_lop_days tables already
-- support the full DRAFT->PROCESSING->LOCKED lifecycle.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('payroll.runs.manage',       'Manage payroll runs', 'payroll', 'Create and process a payroll run (DRAFT -> PROCESSING)'),
    ('payroll.runs.lock',         'Lock payroll runs',   'payroll', 'Lock or reopen a processed payroll run'),
    ('payroll.payslip.read.self', 'View own payslip',    'payroll', 'Employee views own payslip for a locked run')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN + FINANCE_LEAD: run management + lock
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES
    ('payroll.runs.manage'),
    ('payroll.runs.lock')
) AS p(code)
WHERE r.code IN ('SUPER_ADMIN','FINANCE_LEAD') AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- EMPLOYEE: own payslip only
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES ('payroll.payslip.read.self')) AS p(code)
WHERE r.code = 'EMPLOYEE' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER: re-affirm payroll.runs.read (granted in V048; idempotent).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES ('payroll.runs.read')) AS p(code)
WHERE r.code = 'HR_MANAGER' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM rbac.role_permissions
     WHERE permission_code IN ('payroll.runs.manage','payroll.runs.lock','payroll.payslip.read.self');
    RAISE NOTICE 'payroll run-lifecycle grants: % (expect 5: 2 admin roles x 2 + employee x 1)', c;
END $$;
