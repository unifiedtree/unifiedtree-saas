-- V120 — let the application maintain its own monthly partitions.
--
-- attendance.records, attendance.event_logs and audit.events are RANGE
-- partitioned by month, and each has a DEFAULT partition as a safety net.
-- ensure_monthly_partition() creates the next month's children — but NOTHING
-- EVER CALLED IT. There is no pg_cron, no pg_partman and no application job:
-- a repo-wide search finds the function only in these migration files.
--
-- The result (found 2026-09-13): the newest real partition was 2026_08 while
-- the date was already 2026-09-13, so every September row had silently piled
-- into the DEFAULT partitions — 29 attendance records, 47 event logs and 89
-- audit events. No outage, which is exactly why nobody noticed, but:
--
--   * partition pruning stops working for all new data, so every query on
--     these tables degrades toward a full scan of one ever-growing child;
--   * worse, Postgres REFUSES to create records_2026_09 while September rows
--     sit in DEFAULT ("updated partition constraint for default partition
--     would be violated by some row"). Every day of delay makes the eventual
--     repair bigger, and the repair needs a lock on a hot table.
--
-- The rows have been re-routed and partitions pre-created through 2027-03.
-- This migration stops it recurring.
--
-- Why SECURITY DEFINER: the app connects as ut_app, which holds EXECUTE on
-- these functions but has NO CREATE on the attendance/audit schemas, so an
-- invoker-rights call would fail with "permission denied for schema". The
-- functions are owned by postgres, so DEFINER lets them do their one job.
--
-- search_path is pinned because a SECURITY DEFINER function that resolves
-- unqualified names against the caller's search_path is a privilege-escalation
-- hole. Both bodies use format('%I') with schema-qualified targets and take
-- two integers, so there is no injection surface beyond that.

ALTER FUNCTION attendance.ensure_monthly_partition(INT, INT)
    SECURITY DEFINER
    SET search_path = pg_catalog, attendance, public;

ALTER FUNCTION audit.ensure_monthly_partition(INT, INT)
    SECURITY DEFINER
    SET search_path = pg_catalog, audit, public;

-- EXECUTE is already granted to ut_app; make it explicit so a future
-- REVOKE ... FROM PUBLIC does not quietly disable partition maintenance.
GRANT EXECUTE ON FUNCTION attendance.ensure_monthly_partition(INT, INT) TO ut_app;
GRANT EXECUTE ON FUNCTION audit.ensure_monthly_partition(INT, INT)      TO ut_app;

COMMENT ON FUNCTION attendance.ensure_monthly_partition(INT, INT) IS
    'Idempotently creates the monthly partitions of attendance.records and '
    'attendance.event_logs for the given year/month, with RLS enabled on the '
    'children. Called by PartitionMaintenanceJob daily; safe to run from every '
    'Cloud Run instance because CREATE TABLE IF NOT EXISTS is idempotent.';

COMMENT ON FUNCTION audit.ensure_monthly_partition(INT, INT) IS
    'Idempotently creates the monthly partition of audit.events for the given '
    'year/month. Called by PartitionMaintenanceJob daily.';
