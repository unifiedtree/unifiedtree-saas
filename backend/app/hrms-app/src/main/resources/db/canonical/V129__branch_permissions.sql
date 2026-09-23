-- ============================================================================
-- V129 — Add missing branch permissions (hrms.branch.read, hrms.branch.write)
-- ============================================================================

INSERT INTO rbac.permissions (code, module, display_name, description) VALUES
('hrms.branch.read', 'hrms', 'Read Branches', 'Can view company branches'),
('hrms.branch.write', 'hrms', 'Manage Branches', 'Can create and edit branches')
ON CONFLICT (code) DO NOTHING;

-- Grant to SUPER_ADMIN, HR_MANAGER, and OWNER roles
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (
    SELECT unnest(ARRAY['hrms.branch.read', 'hrms.branch.write']) AS code
) p
WHERE r.id IN (
    '00000000-0000-0000-0000-000000000001', -- SUPER_ADMIN
    '00000000-0000-0000-0000-000000000002', -- HR_MANAGER
    '00000000-0000-0000-0000-000000000010'  -- OWNER
)
ON CONFLICT DO NOTHING;
