-- ============================================================================
-- V004 - rbac schema: roles, permissions, grants
-- ============================================================================
-- Two layers:
--   1. System roles (rbac.roles where tenant_id IS NULL) - read-only catalog
--      shipped with the platform (Super Admin, HR Manager, Finance Lead, Employee).
--   2. Tenant-custom roles (tenant_id NOT NULL) - created inside a workspace.
--
-- RLS is enabled but the policy allows system rows for everyone:
--   USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
-- ============================================================================

CREATE TABLE rbac.roles (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID,                                   -- NULL = system role
    code            VARCHAR(50)     NOT NULL,
    display_name    VARCHAR(100)    NOT NULL,
    description     TEXT,
    is_system       BOOLEAN         NOT NULL DEFAULT FALSE,
    is_default_for_new_users BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_role_tenant_code UNIQUE NULLS NOT DISTINCT (tenant_id, code)
);

CREATE INDEX idx_roles_tenant ON rbac.roles(tenant_id);

ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_roles ON rbac.roles
    USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE rbac.permissions (
    code            VARCHAR(100)    PRIMARY KEY,
    display_name    VARCHAR(150)    NOT NULL,
    module          VARCHAR(50)     NOT NULL,
    description     TEXT
);

COMMENT ON TABLE rbac.permissions IS 'Read-only catalog. Permission codes are dotted (hrms.employee.read, hrms.employee.write, attendance.checkin.face).';

-- ----------------------------------------------------------------------------
CREATE TABLE rbac.role_permissions (
    role_id         UUID            NOT NULL REFERENCES rbac.roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(100)    NOT NULL REFERENCES rbac.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

ALTER TABLE rbac.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_visibility ON rbac.role_permissions
    USING (EXISTS (SELECT 1 FROM rbac.roles r
                   WHERE r.id = role_id
                     AND (r.tenant_id IS NULL OR r.tenant_id = current_tenant_id())));

-- ----------------------------------------------------------------------------
CREATE TABLE rbac.user_roles (
    tenant_id       UUID            NOT NULL,
    user_id         UUID            NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    role_id         UUID            NOT NULL REFERENCES rbac.roles(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    granted_by      UUID,
    PRIMARY KEY (tenant_id, user_id, role_id)
);

ALTER TABLE rbac.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_roles ON rbac.user_roles
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Seed system roles (matches client spec)
-- ----------------------------------------------------------------------------
INSERT INTO rbac.roles (id, tenant_id, code, display_name, description, is_system, is_default_for_new_users) VALUES
    ('00000000-0000-0000-0000-000000000001', NULL, 'SUPER_ADMIN',   'Super Admin',   'Full access to all modules and configurations.', TRUE, FALSE),
    ('00000000-0000-0000-0000-000000000002', NULL, 'HR_MANAGER',    'HR Manager',    'Access to Employee, Leave, and Recruitment modules.', TRUE, FALSE),
    ('00000000-0000-0000-0000-000000000003', NULL, 'FINANCE_LEAD',  'Finance Lead',  'Access to Payroll, Expense, and Reports.', TRUE, FALSE),
    ('00000000-0000-0000-0000-000000000004', NULL, 'EMPLOYEE',      'Employee',      'Base ESS access (self-service only).', TRUE, TRUE),
    ('00000000-0000-0000-0000-000000000005', NULL, 'DEPT_MANAGER',  'Dept Manager',  'Manager of a single department; can approve leaves and view team attendance.', TRUE, FALSE)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Seed permission catalog (extend as modules grow)
-- ----------------------------------------------------------------------------
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.employee.read',            'View employees',                'hrms'),
    ('hrms.employee.write',           'Create / edit employees',       'hrms'),
    ('hrms.employee.delete',          'Delete employees',              'hrms'),
    ('hrms.department.read',          'View departments',              'hrms'),
    ('hrms.department.write',         'Create / edit departments',     'hrms'),
    ('hrms.designation.read',         'View designations',             'hrms'),
    ('hrms.designation.write',        'Create / edit designations',    'hrms'),
    ('hrms.contractor.read',          'View contractors',              'hrms'),
    ('hrms.contractor.write',         'Manage contractors',            'hrms'),
    ('org.company.read',              'View companies / branches',     'org'),
    ('org.company.write',             'Create / edit companies / branches', 'org'),
    ('org.geofence.write',            'Configure branch geofence',     'org'),
    ('attendance.checkin.self',       'Punch in/out for self',         'attendance'),
    ('attendance.checkin.face',       'Use face-recognition check-in', 'attendance'),
    ('attendance.team.read',          'View team attendance',          'attendance'),
    ('attendance.regularization.approve', 'Approve attendance regularizations', 'attendance'),
    ('leave.request.self',            'Apply for leave',               'leave'),
    ('leave.balance.read',            'View own leave balance',        'leave'),
    ('leave.request.approve',         'Approve team leave requests',   'leave'),
    ('leave.type.write',              'Configure leave types',         'leave'),
    ('settings.holidays.write',       'Configure holiday calendar',    'settings'),
    ('settings.hrconfig.write',       'Edit HR configuration',         'settings'),
    ('rbac.role.write',               'Manage roles and permissions',  'rbac'),
    ('audit.read',                    'View audit logs',               'audit'),
    ('platform.admin',                'Platform-level administrator',  'platform')
ON CONFLICT (code) DO NOTHING;
