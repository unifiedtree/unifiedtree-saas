-- ============================================================================
-- V030 - Convert NUMERIC columns to DOUBLE PRECISION (or INTEGER) to match
--        Hibernate entity field types (Double / double / int).
--
-- Root cause: V007/V008 used NUMERIC(n,m) for decimal columns. Hibernate
-- maps Java Double → SQL DOUBLE PRECISION (float8). ddl-auto=validate
-- rejects the mismatch on startup.
--
-- Partitioned tables (attendance.records, attendance.event_logs): ALTER on
-- the parent propagates to all child partitions in PostgreSQL 14+.
-- ============================================================================

-- ── attendance.records (partitioned) ─────────────────────────────────────────
ALTER TABLE attendance.records
    ALTER COLUMN check_in_latitude      TYPE DOUBLE PRECISION USING check_in_latitude::DOUBLE PRECISION,
    ALTER COLUMN check_in_longitude     TYPE DOUBLE PRECISION USING check_in_longitude::DOUBLE PRECISION,
    ALTER COLUMN check_out_latitude     TYPE DOUBLE PRECISION USING check_out_latitude::DOUBLE PRECISION,
    ALTER COLUMN check_out_longitude    TYPE DOUBLE PRECISION USING check_out_longitude::DOUBLE PRECISION,
    ALTER COLUMN face_confidence_score  TYPE DOUBLE PRECISION USING face_confidence_score::DOUBLE PRECISION,
    ALTER COLUMN work_hours             TYPE DOUBLE PRECISION USING work_hours::DOUBLE PRECISION;

-- ── attendance.event_logs (partitioned) ──────────────────────────────────────
ALTER TABLE attendance.event_logs
    ALTER COLUMN latitude   TYPE DOUBLE PRECISION USING latitude::DOUBLE PRECISION,
    ALTER COLUMN longitude  TYPE DOUBLE PRECISION USING longitude::DOUBLE PRECISION;

-- ── attendance.shift_policies ─────────────────────────────────────────────────
ALTER TABLE attendance.shift_policies
    ALTER COLUMN working_hours_per_day TYPE DOUBLE PRECISION USING working_hours_per_day::DOUBLE PRECISION;

-- ── leave_mgmt.leave_balances ─────────────────────────────────────────────────
ALTER TABLE leave_mgmt.leave_balances
    ALTER COLUMN total_entitlement  TYPE DOUBLE PRECISION USING total_entitlement::DOUBLE PRECISION,
    ALTER COLUMN used               TYPE DOUBLE PRECISION USING used::DOUBLE PRECISION,
    ALTER COLUMN pending            TYPE DOUBLE PRECISION USING pending::DOUBLE PRECISION,
    ALTER COLUMN carry_forward      TYPE DOUBLE PRECISION USING carry_forward::DOUBLE PRECISION;

-- ── leave_mgmt.leave_requests ─────────────────────────────────────────────────
ALTER TABLE leave_mgmt.leave_requests
    ALTER COLUMN total_days TYPE DOUBLE PRECISION USING total_days::DOUBLE PRECISION;

-- ── leave_mgmt.leave_types ───────────────────────────────────────────────────
ALTER TABLE leave_mgmt.leave_types
    ALTER COLUMN annual_entitlement     TYPE DOUBLE PRECISION USING annual_entitlement::DOUBLE PRECISION,
    ALTER COLUMN carry_forward_max_days TYPE INTEGER          USING carry_forward_max_days::INTEGER;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt
      FROM information_schema.columns
     WHERE table_schema IN ('attendance','leave_mgmt')
       AND data_type = 'double precision';
    RAISE NOTICE 'DOUBLE PRECISION columns in attendance/leave_mgmt after migration: % (expect >= 14)', cnt;
END $$;
