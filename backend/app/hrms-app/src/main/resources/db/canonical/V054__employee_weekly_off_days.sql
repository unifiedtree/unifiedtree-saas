-- Per-employee weekly off days (week-offs).
--
-- Not everyone works Mon-Fri: some employees are off Sat+Sun, some Thu+Sun,
-- some only one day. Attendance math (present/absent/weekend) must respect each
-- employee's own week-offs instead of a hardcoded Saturday+Sunday.
--
-- Stored as a CSV of ISO-8601 day numbers (1=Mon .. 7=Sun). Default '6,7'
-- (Saturday + Sunday) preserves the previous behavior for existing rows.
--
-- NOTE: Flyway is DISABLED on the Railway production deploy
-- (SPRING_FLYWAY_ENABLED=false); the production column was added manually via
-- psycopg. This migration keeps fresh / local / Testcontainers databases (where
-- Flyway runs) passing Hibernate ddl-auto=validate.
ALTER TABLE hrms.employees
    ADD COLUMN IF NOT EXISTS weekly_off_days VARCHAR(20) DEFAULT '6,7';
