-- ============================================================================
-- WIPE ALL CUSTOMER / TEST DATA FROM RAILWAY PRODUCTION DATABASE
-- ============================================================================
-- This script removes ALL customer-created data (tenants, accounts, employees,
-- attendance records, leave data, etc.) while PRESERVING:
--
--   ✓  Flyway migration history (flyway_schema_history)
--   ✓  System roles (rbac.roles)
--   ✓  Permission catalog (rbac.permissions)
--   ✓  Role-permission mappings (rbac.role_permissions)
--   ✓  Module catalog (platform.module_catalog)
--   ✓  All schemas, tables, indexes, RLS policies, functions
--
-- Run with your Railway DATABASE_URL/DB_URL from environment variables.
-- Never commit database credentials into this file.
-- ============================================================================

BEGIN;

-- ── 1. Audit log (no FK deps) ──────────────────────────────────────────────
TRUNCATE TABLE audit.events CASCADE;

-- ── 2. Letters ──────────────────────────────────────────────────────────────
TRUNCATE TABLE letters.generated CASCADE;
TRUNCATE TABLE letters.templates CASCADE;

-- ── 3. Settings (holiday, hr_configuration, notification_templates, integrations)
TRUNCATE TABLE settings.holiday_branches CASCADE;
TRUNCATE TABLE settings.holiday_calendar CASCADE;
TRUNCATE TABLE settings.notification_templates CASCADE;
TRUNCATE TABLE settings.integrations CASCADE;
TRUNCATE TABLE settings.hr_configuration CASCADE;

-- ── 4. Leave management ────────────────────────────────────────────────────
TRUNCATE TABLE leave_mgmt.comp_off_balances CASCADE;
TRUNCATE TABLE leave_mgmt.leave_requests CASCADE;
TRUNCATE TABLE leave_mgmt.leave_balances CASCADE;
TRUNCATE TABLE leave_mgmt.leave_types CASCADE;

-- ── 5. Attendance ──────────────────────────────────────────────────────────
TRUNCATE TABLE attendance.regularization_requests CASCADE;
TRUNCATE TABLE attendance.event_logs CASCADE;
TRUNCATE TABLE attendance.records CASCADE;
TRUNCATE TABLE attendance.employee_shift_assignments CASCADE;
TRUNCATE TABLE attendance.shift_policies CASCADE;

-- ── 6. Geo-fence (public schema) ───────────────────────────────────────────
TRUNCATE TABLE public.geo_fence_audits CASCADE;
TRUNCATE TABLE public.geo_fence_zones CASCADE;

-- ── 7. HRMS employee data ──────────────────────────────────────────────────
TRUNCATE TABLE hrms.onboarding_instance_tasks CASCADE;
TRUNCATE TABLE hrms.onboarding_instances CASCADE;
TRUNCATE TABLE hrms.onboarding_tasks CASCADE;
TRUNCATE TABLE hrms.onboarding_templates CASCADE;
TRUNCATE TABLE hrms.employee_education CASCADE;
TRUNCATE TABLE hrms.employee_experiences CASCADE;
TRUNCATE TABLE hrms.employee_identities CASCADE;
TRUNCATE TABLE hrms.employee_bank_accounts CASCADE;
TRUNCATE TABLE hrms.employee_addresses CASCADE;
TRUNCATE TABLE hrms.employee_dependents CASCADE;
TRUNCATE TABLE hrms.employee_documents CASCADE;
TRUNCATE TABLE hrms.emergency_contacts CASCADE;
TRUNCATE TABLE hrms.contractors CASCADE;
TRUNCATE TABLE hrms.classification_rules CASCADE;
TRUNCATE TABLE hrms.employees CASCADE;
TRUNCATE TABLE hrms.designations CASCADE;
TRUNCATE TABLE hrms.department_branches CASCADE;
TRUNCATE TABLE hrms.departments CASCADE;

-- ── 8. Org structure ───────────────────────────────────────────────────────
TRUNCATE TABLE org.geofence_zones CASCADE;
TRUNCATE TABLE org.shifts CASCADE;
TRUNCATE TABLE org.grades CASCADE;
TRUNCATE TABLE org.employment_types CASCADE;
TRUNCATE TABLE org.branches CASCADE;
TRUNCATE TABLE org.companies CASCADE;

-- ── 9. Auth & RBAC user-data (keep catalog rows) ──────────────────────────
-- user_roles maps users ↔ roles. Wipe the grants, keep roles/permissions.
TRUNCATE TABLE rbac.user_roles CASCADE;

-- Wipe auth sessions and credentials
TRUNCATE TABLE auth.refresh_tokens CASCADE;
TRUNCATE TABLE auth.otp_codes CASCADE;
TRUNCATE TABLE auth.user_credentials CASCADE;

-- ── 10. Account portal (global accounts + workspace memberships) ───────────
TRUNCATE TABLE platform.account_workspaces CASCADE;
TRUNCATE TABLE platform.accounts CASCADE;

-- ── 11. Platform tenants & modules ─────────────────────────────────────────
TRUNCATE TABLE platform.tenant_modules CASCADE;
TRUNCATE TABLE platform.tenant_domains CASCADE;
TRUNCATE TABLE platform.tenants CASCADE;
-- module_catalog is KEPT (seeded by Flyway)

-- ── 12. Notification ───────────────────────────────────────────────────────
-- (only if notification table exists under a schema)
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE hrms.notifications CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── 13. Face verification data ─────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE attendance.face_templates CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE attendance.face_verification_logs CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================================
-- VERIFICATION: Show remaining row counts for system catalog tables
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '──── WIPE COMPLETE ────';
  RAISE NOTICE 'Preserved system catalog rows:';
  FOR r IN
    SELECT 'rbac.roles' AS tbl, count(*) AS cnt FROM rbac.roles
    UNION ALL
    SELECT 'rbac.permissions', count(*) FROM rbac.permissions
    UNION ALL
    SELECT 'rbac.role_permissions', count(*) FROM rbac.role_permissions
    UNION ALL
    SELECT 'platform.module_catalog', count(*) FROM platform.module_catalog
  LOOP
    RAISE NOTICE '  % : % rows', r.tbl, r.cnt;
  END LOOP;
  RAISE NOTICE 'Flyway history preserved (flyway_schema_history untouched).';
  RAISE NOTICE '──── DONE ────';
END $$;

COMMIT;
