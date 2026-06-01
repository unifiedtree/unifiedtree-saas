-- ============================================================================
-- V023 - Add profile, identity, bank, leave-approval, and onboarding
--        permission codes that were referenced by controllers but missing
--        from the rbac.permissions catalog.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.employee.profile.read',       'View employee profile sections',           'hrms'),
    ('hrms.employee.profile.write',      'Edit employee profile sections',           'hrms'),
    ('hrms.employee.identity.read',      'View PII identity documents',              'hrms'),
    ('hrms.employee.identity.write',     'Edit PII identity documents',              'hrms'),
    ('hrms.employee.bank.read',          'View employee bank account details',       'hrms'),
    ('hrms.employee.bank.write',         'Manage employee bank accounts',            'hrms'),
    ('hrms.leave.approve.l1',            'L1 leave approval (manager)',              'hrms'),
    ('hrms.leave.approve.l2',            'L2 leave approval (HR)',                   'hrms'),
    ('hrms.onboarding.template.read',    'View onboarding templates',                'hrms'),
    ('hrms.onboarding.template.write',   'Manage onboarding templates and tasks',    'hrms'),
    ('hrms.onboarding.instance.read',    'View employee onboarding instances',       'hrms'),
    ('hrms.onboarding.instance.write',   'Create and manage onboarding instances',   'hrms'),
    ('hrms.onboarding.task.complete',    'Mark onboarding tasks complete',           'hrms')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN must remain a true superset of all permission codes.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.employee.profile.read',  'hrms.employee.profile.write',
     'hrms.employee.identity.read', 'hrms.employee.identity.write',
     'hrms.employee.bank.read',     'hrms.employee.bank.write',
     'hrms.leave.approve.l1',       'hrms.leave.approve.l2',
     'hrms.onboarding.template.read',  'hrms.onboarding.template.write',
     'hrms.onboarding.instance.read',  'hrms.onboarding.instance.write',
     'hrms.onboarding.task.complete'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER gets the same set (manages employee profile/identity/onboarding,
-- can approve L1 leave).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.employee.profile.read',  'hrms.employee.profile.write',
     'hrms.employee.identity.read', 'hrms.employee.identity.write',
     'hrms.employee.bank.read',     'hrms.employee.bank.write',
     'hrms.leave.approve.l1',       'hrms.leave.approve.l2',
     'hrms.onboarding.template.read',  'hrms.onboarding.template.write',
     'hrms.onboarding.instance.read',  'hrms.onboarding.instance.write',
     'hrms.onboarding.task.complete'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- DEPT_MANAGER gets L1 leave approval and onboarding task completion.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000005', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.employee.profile.read',
     'hrms.leave.approve.l1',
     'hrms.onboarding.instance.read',
     'hrms.onboarding.task.complete'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;
