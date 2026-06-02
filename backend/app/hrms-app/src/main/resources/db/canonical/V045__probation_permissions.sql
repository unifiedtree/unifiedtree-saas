-- ============================================================================
-- V045 - Probation permissions + role grants
-- ----------------------------------------------------------------------------
-- The employee Confirm/Extend actions REUSE 'hrms.employee.write' (existing).
-- The /upcoming list reuses 'hrms.employee.read' (existing). These NEW codes
-- gate only the probation config screen and the reminder log.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.probation.config.read',    'View probation settings',   'hrms', 'View tenant probation reminder configuration'),
    ('hrms.probation.config.update',  'Update probation settings', 'hrms', 'Modify reminder lead time and auto-extension'),
    ('hrms.probation.reminders.read', 'View probation reminders',  'hrms', 'See log of fired probation reminders')
ON CONFLICT (code) DO NOTHING;

-- Grant all three to SUPER_ADMIN (001) and HR_MANAGER (002).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (VALUES
    ('hrms.probation.config.read'),
    ('hrms.probation.config.update'),
    ('hrms.probation.reminders.read')
) AS p(code)
WHERE r.code IN ('SUPER_ADMIN', 'HR_MANAGER') AND r.is_system = TRUE
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.probation.%';
    RAISE NOTICE 'probation permission grants: % (expect 6)', c;
END $$;
