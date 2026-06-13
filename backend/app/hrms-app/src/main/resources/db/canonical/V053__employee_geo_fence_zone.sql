-- Per-employee assigned punch zone.
--
-- When set, the attendance geofence check enforces THIS zone's coordinates and
-- radius (resolved in AttendanceContextResolver) instead of the employee's
-- branch. Null = fall back to the branch geofence (or company-wide).
--
-- NOTE: Flyway is intentionally DISABLED on the Railway production deploy
-- (SPRING_FLYWAY_ENABLED=false); the production column was added manually via
-- psycopg. This migration exists so fresh / local / Testcontainers databases —
-- where Flyway DOES run — pass Hibernate ddl-auto=validate for the
-- Employee / WorkforceEmployee entities that now map geo_fence_zone_id.
ALTER TABLE hrms.employees
    ADD COLUMN IF NOT EXISTS geo_fence_zone_id UUID;
