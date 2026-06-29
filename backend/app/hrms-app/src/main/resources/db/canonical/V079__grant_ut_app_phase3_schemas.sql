-- ============================================================================
-- V079 - Grant the runtime app role(s) on all Phase-3 module schemas
-- ----------------------------------------------------------------------------
-- The production app connects as the NON-owner role `ut_app` (RLS-gated). The
-- per-module migrations V067-V078 granted `hrms_app`/`app_user` but NOT `ut_app`
-- (and `app_user` does not exist in prod), so `ut_app` hit "permission denied for
-- schema ..." -> HTTP 500 on every new-module endpoint, while leave_mgmt (granted
-- to ut_app historically) kept working.
--
-- This grants USAGE + CRUD on every Phase-3 schema, and EXECUTE on
-- current_tenant_id(), to whichever of ut_app / hrms_app / app_user exist.
-- Idempotent + guarded; safe to re-run and to apply manually (Flyway off in prod).
-- ============================================================================
DO $$
DECLARE
  s text;
  r text;
  schemas text[] := ARRAY[
    'expense_mgmt','advance_mgmt','fnf_mgmt','hiring_mgmt','performance_mgmt',
    'document_mgmt','learning_mgmt','compliance_mgmt','policy_mgmt',
    'pli_mgmt','integration_mgmt','notiftemplate_mgmt'
  ];
  roles text[] := ARRAY['ut_app','hrms_app','app_user'];
BEGIN
  FOREACH r IN ARRAY roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH s IN ARRAY schemas LOOP
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = s) THEN
          EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, r);
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, r);
        END IF;
      END LOOP;
      EXECUTE format('GRANT EXECUTE ON FUNCTION current_tenant_id() TO %I', r);
    END IF;
  END LOOP;
  RAISE NOTICE 'V079: granted ut_app/hrms_app/app_user on Phase-3 schemas';
END $$;
