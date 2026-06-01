-- ============================================================================
-- V027 - Seed hrms.employee.import permission used by BulkImportController
--        @PreAuthorize("@perm.check('hrms.employee.import')")
--
-- Grants: SUPER_ADMIN (full superset) + HR_MANAGER + FINANCE_LEAD
-- EMPLOYEE is intentionally excluded — bulk import is an admin operation.
-- Idempotent via ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.employee.import', 'Bulk import employees via CSV/XLSX', 'hrms')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN must remain a true superset of all permission codes
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code = 'hrms.employee.import'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER: primary HR operator — owns employee lifecycle including imports
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002', code
  FROM rbac.permissions
 WHERE code = 'hrms.employee.import'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- FINANCE_LEAD: needs to bulk-load contractor/payroll employees for setup
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000003', code
  FROM rbac.permissions
 WHERE code = 'hrms.employee.import'
ON CONFLICT (role_id, permission_code) DO NOTHING;
