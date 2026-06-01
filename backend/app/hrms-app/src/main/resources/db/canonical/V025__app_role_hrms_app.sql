-- ============================================================================
-- V025 - Application role (hrms_app) for RLS-enforced non-superuser access
--        + hrms.grade.write, hrms.employment-type.write, hrms.shift.write
--          permission codes and grants to SUPER_ADMIN + HR_MANAGER
-- ============================================================================
-- Superuser connections bypass Row-Level Security even when FORCE ROW LEVEL
-- SECURITY is set on a table. The application and integration-test JDBC
-- connections must SET LOCAL ROLE hrms_app so that tenant_isolation policies
-- are actually enforced.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        CREATE ROLE hrms_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

-- Schema usage
GRANT USAGE ON SCHEMA platform, auth, rbac, org, hrms, attendance, leave_mgmt, settings, audit TO hrms_app;

-- Table DML
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform    TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth        TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rbac        TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org         TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hrms        TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA attendance  TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA leave_mgmt  TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA settings    TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit       TO hrms_app;

-- Sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform    TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth        TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rbac        TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA org         TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA hrms        TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA attendance  TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA leave_mgmt  TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA settings    TO hrms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit       TO hrms_app;

-- Tenant-resolution function
GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;

-- ----------------------------------------------------------------------------
-- Org entity permission codes used by WorkforceController @PreAuthorize
-- but missing from the rbac.permissions catalog until now.
-- Single .write code per entity covers create, update, and delete operations.
-- ----------------------------------------------------------------------------
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.grade.write',           'Manage pay grades',              'hrms'),
    ('hrms.employment-type.write', 'Manage employment types',        'hrms'),
    ('hrms.shift.write',           'Manage work shifts',             'hrms')
ON CONFLICT (code) DO NOTHING;

-- SUPER_ADMIN is a true superset: grant the new codes.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code IN ('hrms.grade.write', 'hrms.employment-type.write', 'hrms.shift.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER manages org structure.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002', code
  FROM rbac.permissions
 WHERE code IN ('hrms.grade.write', 'hrms.employment-type.write', 'hrms.shift.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;
