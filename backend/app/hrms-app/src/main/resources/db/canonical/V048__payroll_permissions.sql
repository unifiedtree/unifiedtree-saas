-- ============================================================================
-- V048 - Payroll permissions + role grants (Prompt 12)
-- ----------------------------------------------------------------------------
-- SUPER_ADMIN + FINANCE_LEAD: full payroll access.
-- HR_MANAGER: read-only (sees CTC, can't change).
-- EMPLOYEE: own structure only (payroll.structure.read.self).
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('payroll.settings.read',       'View payroll settings',           'payroll', 'View tenant PF/ESI/PT configuration'),
    ('payroll.settings.update',     'Update payroll settings',         'payroll', 'Modify statutory toggles and rates'),
    ('payroll.components.read',     'View salary components',          'payroll', 'View salary component catalog'),
    ('payroll.components.manage',   'Manage salary components',        'payroll', 'Create/update/disable components'),
    ('payroll.structure.read',      'View employee salary structures', 'payroll', 'View per-employee CTC breakdown'),
    ('payroll.structure.read.self', 'View own salary structure',       'payroll', 'Employee views own salary structure'),
    ('payroll.structure.manage',    'Manage salary structures',        'payroll', 'Assign/update employee CTC'),
    ('payroll.runs.read',           'View payroll runs',               'payroll', 'View payroll run history'),
    ('payroll.pt_slabs.read',       'View Professional Tax slabs',     'payroll', 'Reference data')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN + FINANCE_LEAD: everything except read.self (they use the full read)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES
    ('payroll.settings.read'), ('payroll.settings.update'),
    ('payroll.components.read'), ('payroll.components.manage'),
    ('payroll.structure.read'), ('payroll.structure.manage'),
    ('payroll.runs.read'), ('payroll.pt_slabs.read')
) AS p(code)
WHERE r.code IN ('SUPER_ADMIN','FINANCE_LEAD') AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER: read-only
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES
    ('payroll.settings.read'), ('payroll.components.read'),
    ('payroll.structure.read'), ('payroll.runs.read'), ('payroll.pt_slabs.read')
) AS p(code)
WHERE r.code = 'HR_MANAGER' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- EMPLOYEE: own structure + PT slabs (reference, harmless)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES ('payroll.structure.read.self'), ('payroll.pt_slabs.read')) AS p(code)
WHERE r.code = 'EMPLOYEE' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM rbac.permissions WHERE module = 'payroll';
    RAISE NOTICE 'payroll permissions in catalog: % (expect 9)', c;
END $$;
