-- ============================================================================
-- V017 - canonical seed: role -> permission mappings for system roles
-- ============================================================================
-- SAFE for production. Catalog-only data:
--   - assigns the full permission catalog to SUPER_ADMIN
--   - assigns a tight read-only set to EMPLOYEE (used as the default role
--     for new users created during tenant bootstrap)
--
-- DOES NOT create:
--   - any tenants
--   - any user_credentials rows
--   - any rbac.user_roles grants
--
-- Production admin onboarding happens via the env-based bootstrap path
-- described in BOOTSTRAP.md, not via Flyway. Dev/smoke convenience users
-- live in classpath:db/dev-seed (only loaded under the 'canonical' profile,
-- never under canonical-prod).
-- ============================================================================

-- Wipe and re-seed role_permissions for the two system roles we touch here.
-- Idempotent across re-runs.
DELETE FROM rbac.role_permissions
 WHERE role_id IN (
   '00000000-0000-0000-0000-000000000001',  -- SUPER_ADMIN
   '00000000-0000-0000-0000-000000000004'   -- EMPLOYEE
 );

-- SUPER_ADMIN gets every permission currently in the catalog.
-- Future migrations that add permissions should also add a similar fan-out
-- so SUPER_ADMIN stays a true superset.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code FROM rbac.permissions;

-- EMPLOYEE (the default role for new tenant users) gets only the read +
-- self-service permissions. Operations that mutate company data require
-- HR_MANAGER / SUPER_ADMIN explicitly.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000004', 'hrms.employee.read'),
    ('00000000-0000-0000-0000-000000000004', 'hrms.department.read'),
    ('00000000-0000-0000-0000-000000000004', 'hrms.designation.read'),
    ('00000000-0000-0000-0000-000000000004', 'leave.balance.read'),
    ('00000000-0000-0000-0000-000000000004', 'leave.request.self'),
    ('00000000-0000-0000-0000-000000000004', 'attendance.checkin.self');
