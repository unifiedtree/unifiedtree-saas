-- Add delete permission for generated letters
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.letters.delete', 'Letters Delete', 'hrms', 'Delete a generated letter')
ON CONFLICT (code) DO NOTHING;

-- Grant to SUPER_ADMIN and HR_MANAGER only
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.letters.delete'
FROM rbac.roles r
WHERE r.code IN ('SUPER_ADMIN', 'HR_MANAGER') AND r.is_system = true
ON CONFLICT (role_id, permission_code) DO NOTHING;
