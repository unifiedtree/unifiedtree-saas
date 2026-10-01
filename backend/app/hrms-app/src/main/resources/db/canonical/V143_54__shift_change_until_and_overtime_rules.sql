-- V143.54: a temporary shift change ("Until") and company overtime rules
-- (redesign P-ATT-PLAN, BW-31 and BW-29).
--
-- 1. attendance.shift_change_requests.requested_end_date: the last day of a
--    temporary shift change. NULL means permanent, which is every request made
--    before this migration and every request that leaves "Until" empty. On
--    approval the new shift runs until this date and the shift the person was
--    on comes back the next day. The table is read and written with JDBC only
--    (ShiftChangeRequestService; no JPA entity maps it). Its startup bootstrap
--    (ShiftChangeRequestSchemaBootstrap) is left as it is: the runtime role
--    can't ALTER the table, so the column comes from here.
-- 2. attendance.overtime_rules: per company, the minimum overtime (extra time
--    under it doesn't count; once it is reached ALL the extra time counts) and
--    the most overtime that can be approved per person per month. No row, or a
--    NULL minimum, means the default minimum of 60 minutes (client decision,
--    2 Oct 2026); a NULL cap means no cap. The rules change only which minutes are counted and
--    approved: stored overtime minutes, work hours and pay never change, and
--    overtime is still recorded, not paid. JDBC only (OvertimeRulesController,
--    OvertimeController); no JPA entity maps it.
--
-- No JPA-mapped column is added or changed. No new permission: reading the
-- rules needs attendance.team.read, changing them attendance.policy.manage.
--
-- Idempotent (IF NOT EXISTS, guarded DO blocks). Production has Flyway OFF:
-- apply by hand, as a superuser (row-level security, grants).

-- ── 1. "Until" on a shift change request ─────────────────────────────────────
ALTER TABLE attendance.shift_change_requests
    ADD COLUMN IF NOT EXISTS requested_end_date DATE;

COMMENT ON COLUMN attendance.shift_change_requests.requested_end_date IS
    'Last day of a temporary shift change; NULL = permanent. The previous shift comes back the next day (V143.54).';

-- An end date never comes before the start date. Added only when missing; the
-- column is new, so every existing row is NULL and passes.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_scr_end_on_or_after_start'
                      AND conrelid = 'attendance.shift_change_requests'::regclass) THEN
        ALTER TABLE attendance.shift_change_requests
            ADD CONSTRAINT ck_scr_end_on_or_after_start
            CHECK (requested_end_date IS NULL
                   OR requested_effective_date IS NULL
                   OR requested_end_date >= requested_effective_date);
    END IF;
END $$;

-- ── 2. company overtime rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.overtime_rules (
    tenant_id             UUID          NOT NULL,
    company_id            UUID          NOT NULL,
    minimum_minutes       INTEGER,
    monthly_cap_minutes   INTEGER,
    updated_by_user_id    UUID,
    updated_by_name       VARCHAR(200),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_overtime_rules PRIMARY KEY (tenant_id, company_id),
    CONSTRAINT ck_overtime_rules_minimum
        CHECK (minimum_minutes IS NULL OR minimum_minutes BETWEEN 0 AND 1440),
    CONSTRAINT ck_overtime_rules_monthly_cap
        CHECK (monthly_cap_minutes IS NULL OR monthly_cap_minutes BETWEEN 0 AND 44640)
);

COMMENT ON TABLE attendance.overtime_rules IS
    'Company overtime rules: the minimum overtime (a threshold) and the monthly approval cap per person (V143.54).';
COMMENT ON COLUMN attendance.overtime_rules.minimum_minutes IS
    'Minimum overtime: extra time under it does not count; once reached, all of it counts. NULL = the default, 60 minutes.';
COMMENT ON COLUMN attendance.overtime_rules.monthly_cap_minutes IS
    'Most counted overtime that can be approved per person per calendar month. NULL = no cap.';

ALTER TABLE attendance.overtime_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.overtime_rules FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'overtime_rules'
                      AND policyname = 'tenant_isolation_overtime_rules') THEN
        CREATE POLICY tenant_isolation_overtime_rules ON attendance.overtime_rules
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. grants for the runtime role ───────────────────────────────────────────
-- The new column inherits the table-level grants V142 gave ut_app.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.overtime_rules TO ut_app;
    ELSE
        RAISE NOTICE 'V143.54: role ut_app not present — grants skipped';
    END IF;
END $$;
