-- ============================================================================
-- V012 - FORCE row-level security on every tenant-owned table
-- ============================================================================
-- PostgreSQL bypasses RLS for the table's OWNER unless FORCE is set. In dev
-- and most prod setups the migration runs as the same role that runs the
-- app, which makes RLS a no-op. FORCE closes that gap.
--
-- (For production, the recommended setup is a dedicated app role that is
-- not the owner. This migration is belt + suspenders.)
-- ============================================================================

-- auth
ALTER TABLE auth.user_credentials   FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.otp_codes          FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.refresh_tokens     FORCE ROW LEVEL SECURITY;

-- rbac
ALTER TABLE rbac.roles              FORCE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_permissions   FORCE ROW LEVEL SECURITY;
ALTER TABLE rbac.user_roles         FORCE ROW LEVEL SECURITY;

-- org
ALTER TABLE org.companies           FORCE ROW LEVEL SECURITY;
ALTER TABLE org.branches            FORCE ROW LEVEL SECURITY;
ALTER TABLE org.geofence_zones      FORCE ROW LEVEL SECURITY;

-- hrms
ALTER TABLE hrms.departments         FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.department_branches FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.designations        FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.employees           FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.contractors         FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.classification_rules FORCE ROW LEVEL SECURITY;

-- attendance
ALTER TABLE attendance.shift_policies              FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance.employee_shift_assignments  FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance.records                     FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance.event_logs                  FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance.regularization_requests     FORCE ROW LEVEL SECURITY;

-- leave_mgmt
ALTER TABLE leave_mgmt.leave_types       FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.leave_balances    FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.leave_requests    FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.comp_off_balances FORCE ROW LEVEL SECURITY;

-- settings
ALTER TABLE settings.hr_configuration       FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.holiday_calendar       FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.holiday_branches       FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.notification_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.integrations           FORCE ROW LEVEL SECURITY;
