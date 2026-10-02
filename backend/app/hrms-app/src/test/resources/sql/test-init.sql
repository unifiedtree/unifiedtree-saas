-- Roles the canonical migrations expect, created at container startup, before Flyway runs.
--
--  * hrms_app: the role the app's DataSource connects as (permissions granted by Flyway V025),
--    so HikariCP can authenticate on the first connection.
--  * ut_app: the role the canonical migrations grant to. Production has it and never runs
--    Flyway (migrations are applied by hand), so nothing there depends on this file. A fresh
--    Testcontainers database has neither role, and the first migration that grants to ut_app
--    without checking (V093__lead_requests.sql) fails the whole run. Most canonical migrations
--    guard their grants with a pg_roles check; eight do not. Creating the role here matches
--    production instead of weakening those migrations.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        CREATE ROLE hrms_app LOGIN PASSWORD 'hrms_app_test' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        CREATE ROLE ut_app LOGIN PASSWORD 'ut_app_test' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

-- The app's DataSource connects as hrms_app, but the canonical migrations are
-- inconsistent about which role they grant to: timing_policies,
-- distribution_schedules and letter_signatures grant to ut_app only, and
-- shift_change_requests has no grant at all. Reading them as hrms_app raises
-- "permission denied for table ...", which surfaces as a 500 out of
-- AttendancePolicyService and the letters jobs.
--
-- Production is unaffected — it has both roles with grants applied by hand and
-- never runs Flyway — so this is a test-role problem and is fixed here rather
-- than by widening the grants in the migrations themselves.
--
-- Default privileges apply only to objects created after this runs, which is
-- why it belongs in the init script: Flyway connects as ut_test and creates
-- everything afterwards, so every table it makes is covered whichever role the
-- individual migration happens to name.
ALTER DEFAULT PRIVILEGES FOR ROLE ut_test GRANT ALL ON TABLES    TO hrms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ut_test GRANT ALL ON SEQUENCES TO hrms_app;
