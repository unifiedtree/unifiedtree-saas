-- Harden leave_mgmt.leave_types.carry_forward_max_days.
--
-- ROOT CAUSE of "Cannot reach the HRMS server" on login: this column was
-- nullable with no default. Existing rows had NULL. The Java entity field is
-- `Integer maxCarryForwardDays = 0` (was `int` — the primitive is what blew up:
-- Hibernate failed to assign NULL to a primitive, threw PropertyAccessException,
-- and the leave overview endpoint called by the home tile after login 500'd.
-- The mobile client interpreted that as a network failure.
--
-- Fix: backfill NULL -> 0, set a default, and make it NOT NULL so a future
-- insert that omits the column can't reintroduce the bug.
--
-- NOTE: Flyway is DISABLED on Railway production (SPRING_FLYWAY_ENABLED=false);
-- production was already backfilled + hardened manually via psycopg. This
-- migration keeps fresh / local / Testcontainers DBs aligned.

UPDATE leave_mgmt.leave_types SET carry_forward_max_days = 0 WHERE carry_forward_max_days IS NULL;
ALTER TABLE leave_mgmt.leave_types ALTER COLUMN carry_forward_max_days SET DEFAULT 0;
ALTER TABLE leave_mgmt.leave_types ALTER COLUMN carry_forward_max_days SET NOT NULL;
