-- ============================================================================
-- V040 - hrms.employee.invite permission + role grants
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.employee.invite',
     'Invite Employee',
     'hrms',
     'Send invitation email to add employee user account')
ON CONFLICT (code) DO NOTHING;

-- Grant to SUPER_ADMIN and HR_MANAGER only
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.employee.invite'
  FROM rbac.roles r
 WHERE r.code IN ('SUPER_ADMIN', 'HR_MANAGER')
ON CONFLICT (role_id, permission_code) DO NOTHING;
