-- =============================================================================
-- Letters module permissions + role grants
-- =============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.letters.template.read',   'Letters Template Read',   'hrms', 'View letter templates'),
    ('hrms.letters.template.create', 'Letters Template Create', 'hrms', 'Create letter templates'),
    ('hrms.letters.template.update', 'Letters Template Update', 'hrms', 'Update letter templates'),
    ('hrms.letters.template.delete', 'Letters Template Delete', 'hrms', 'Delete letter templates'),
    ('hrms.letters.generate',        'Letters Generate',        'hrms', 'Generate letters for employees'),
    ('hrms.letters.read',            'Letters Read',            'hrms', 'View generated letters'),
    ('hrms.letters.read.self',       'Letters Read Self',       'hrms', 'View own generated letters'),
    ('hrms.letters.send',            'Letters Send',            'hrms', 'Email letters to recipients'),
    ('hrms.letters.void',            'Letters Void',            'hrms', 'Void a generated letter')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN + HR_MANAGER + FINANCE_LEAD: full template + generation access
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (
    SELECT unnest(ARRAY[
        'hrms.letters.template.read','hrms.letters.template.create',
        'hrms.letters.template.update','hrms.letters.template.delete',
        'hrms.letters.generate','hrms.letters.read','hrms.letters.send','hrms.letters.void'
    ]) AS code
) p
WHERE r.code IN ('SUPER_ADMIN','HR_MANAGER','FINANCE_LEAD') AND r.is_system = true
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- DEPT_MANAGER: read + generate + send (no template CRUD, no void)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM rbac.roles r
CROSS JOIN (
    SELECT unnest(ARRAY[
        'hrms.letters.template.read','hrms.letters.generate',
        'hrms.letters.read','hrms.letters.send'
    ]) AS code
) p
WHERE r.code = 'DEPT_MANAGER' AND r.is_system = true
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- EMPLOYEE: self-read only
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.letters.read.self'
FROM rbac.roles r
WHERE r.code = 'EMPLOYEE' AND r.is_system = true
ON CONFLICT (role_id, permission_code) DO NOTHING;
