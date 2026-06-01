-- ============================================================================
-- V018 - schema audit fixes
-- ============================================================================
-- 1. Index on tenant_id for the two join tables that lacked one
-- 2. Enable + FORCE row-level security on every existing partition child
-- 3. Replace attendance.ensure_monthly_partition so future partitions also
--    auto-enable + FORCE RLS
--
-- All idempotent.
-- ============================================================================

-- 1. tenant_id indexes on join tables
CREATE INDEX IF NOT EXISTS idx_department_branches_tenant
    ON hrms.department_branches (tenant_id);

CREATE INDEX IF NOT EXISTS idx_holiday_branches_tenant
    ON settings.holiday_branches (tenant_id);

-- 2. Enable + FORCE RLS on every existing partition child of
--    attendance.records and attendance.event_logs. The parent already has
--    RLS enabled but Postgres doesn't auto-propagate that to declarative
--    partitions created BEFORE the parent had RLS turned on.
DO $$
DECLARE
    child RECORD;
BEGIN
    FOR child IN
        SELECT pn.nspname AS schema_name, pc.relname AS table_name
        FROM pg_inherits i
        JOIN pg_class pc       ON i.inhrelid = pc.oid
        JOIN pg_namespace pn   ON pc.relnamespace = pn.oid
        JOIN pg_class parent   ON i.inhparent = parent.oid
        JOIN pg_namespace pns  ON parent.relnamespace = pns.oid
        WHERE pns.nspname = 'attendance'
          AND parent.relrowsecurity = TRUE
          AND pc.relrowsecurity = FALSE
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                       child.schema_name, child.table_name);
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                       child.schema_name, child.table_name);
    END LOOP;
END $$;

-- 3. Re-create the partition-provisioning helper so newly created monthly
--    partitions automatically enable + FORCE RLS.
CREATE OR REPLACE FUNCTION attendance.ensure_monthly_partition(p_year INT, p_month INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    rec_partition_name  TEXT;
    log_partition_name  TEXT;
    range_start         DATE;
    range_end           DATE;
BEGIN
    range_start := make_date(p_year, p_month, 1);
    range_end   := range_start + INTERVAL '1 month';
    rec_partition_name := format('records_%s_%s', p_year, lpad(p_month::TEXT, 2, '0'));
    log_partition_name := format('event_logs_%s_%s', p_year, lpad(p_month::TEXT, 2, '0'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS attendance.%I PARTITION OF attendance.records
            FOR VALUES FROM (%L) TO (%L)',
        rec_partition_name, range_start, range_end);
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS attendance.%I PARTITION OF attendance.event_logs
            FOR VALUES FROM (%L) TO (%L)',
        log_partition_name, range_start::TIMESTAMPTZ, range_end::TIMESTAMPTZ);

    -- RLS on the new children (idempotent; PG ignores re-enabling).
    EXECUTE format('ALTER TABLE attendance.%I ENABLE ROW LEVEL SECURITY',     rec_partition_name);
    EXECUTE format('ALTER TABLE attendance.%I FORCE ROW LEVEL SECURITY',      rec_partition_name);
    EXECUTE format('ALTER TABLE attendance.%I ENABLE ROW LEVEL SECURITY',     log_partition_name);
    EXECUTE format('ALTER TABLE attendance.%I FORCE ROW LEVEL SECURITY',      log_partition_name);
END;
$$;

COMMENT ON FUNCTION attendance.ensure_monthly_partition(INT, INT) IS
    'Idempotently creates the monthly partition for attendance.records and
     attendance.event_logs, and enables + forces RLS on the new children.
     Called from app boot and from a daily cron.';
