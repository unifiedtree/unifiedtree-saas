-- =============================================================================
-- Bulk letter distribution permission + role grants.
--
-- Granted to SUPER_ADMIN + HR_MANAGER only. Deliberately NOT granted to
-- FINANCE_LEAD, DEPT_MANAGER, or EMPLOYEE (bulk distribution is HR's job; this
-- is also kept off FINANCE_LEAD per the open FL over-permission review).
-- Mirrors the seed format used in V033__letters_permissions.sql.
-- =============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.letters.distribute', 'Letters Bulk Distribute', 'hrms', 'Send letters to multiple employees in bulk')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.letters.distribute'
FROM rbac.roles r
WHERE r.code IN ('SUPER_ADMIN','HR_MANAGER') AND r.is_system = true
ON CONFLICT (role_id, permission_code) DO NOTHING;
