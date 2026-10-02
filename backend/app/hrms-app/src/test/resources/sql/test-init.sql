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
