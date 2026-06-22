-- ============================================================================
-- V063 - Grant org.geofence.write to HR_MANAGER
-- ----------------------------------------------------------------------------
-- Gap: org.geofence.write was registered in V004 and picked up by V017 for
-- SUPER_ADMIN, but was never explicitly granted to HR_MANAGER.
-- Geofencing zones are an HR/admin configuration (defining office locations
-- for attendance tracking), so HR_MANAGER must be able to add/edit/remove them.
--
-- SUPER_ADMIN already holds this via V017 fan-out — no change needed there.
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'org.geofence.write')   -- HR_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM rbac.role_permissions
     WHERE role_id = '00000000-0000-0000-0000-000000000002'
       AND permission_code = 'org.geofence.write';
    RAISE NOTICE 'HR_MANAGER org.geofence.write grants: % (expect 1)', c;
END $$;
