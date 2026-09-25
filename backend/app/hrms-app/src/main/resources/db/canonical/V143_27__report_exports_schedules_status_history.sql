-- V143.27: reports and audit (w2h).
--
-- 1. hrms.report_exports: the server export log. Every report download
--    (CSV and PDF straight from the server, Excel / PNG / CSV files the browser
--    builds from the numbers on screen, the audit log export and scheduled
--    report emails) is one row: who, which report, which format, the filters,
--    the company, the row count, when. The Reports Center "Recent downloads"
--    reads it, so the history is shared and auditable instead of living in one
--    browser's localStorage.
-- 2. hrms.report_schedules: weekly or monthly report emails. A schedule names
--    one report, one company, the day it goes out and the workspace members
--    who receive it (as a PDF). ReportScheduleJob sends the due ones every
--    morning, tenant by tenant.
-- 3. hrms.employee_status_history: every employment status change, dated by
--    when it took effect. Fed by a trigger on hrms.employees (so every path
--    that changes a status is caught: the exit flow, confirmation, imports,
--    direct edits) and backfilled from the dates already on each employee
--    record. The headcount report on a past date reads it for the active /
--    notice / probation split instead of today's status.
-- 4. Two permissions: hrms.report.exports.read_all and
--    hrms.report.schedule.manage (OWNER and SUPER_ADMIN hold every permission).
--
-- Idempotent. Production has Flyway off: apply by hand after V143_26.

-- ── 1. Export log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.report_exports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL,
    user_id      UUID,
    report       VARCHAR(60)  NOT NULL,
    report_label VARCHAR(120) NOT NULL,
    format       VARCHAR(10)  NOT NULL,
    source       VARCHAR(10)  NOT NULL DEFAULT 'SERVER',
    file_name    VARCHAR(255),
    company_id   UUID,
    company_name VARCHAR(255),
    filters      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    row_count    INTEGER,
    size_bytes   BIGINT,
    schedule_id  UUID,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_report_exports_format CHECK (format IN ('CSV', 'XLSX', 'PDF', 'PNG')),
    CONSTRAINT ck_report_exports_source CHECK (source IN ('SERVER', 'BROWSER', 'SCHEDULE'))
);
CREATE INDEX IF NOT EXISTS idx_report_exports_tenant_created
    ON hrms.report_exports (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_exports_tenant_user
    ON hrms.report_exports (tenant_id, user_id, created_at DESC);

ALTER TABLE hrms.report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.report_exports FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hrms' AND tablename = 'report_exports'
                      AND policyname = 'tenant_isolation_report_exports') THEN
        CREATE POLICY tenant_isolation_report_exports ON hrms.report_exports
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. Scheduled report emails ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.report_schedules (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    company_id         UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    report             VARCHAR(60) NOT NULL,
    frequency          VARCHAR(10) NOT NULL,
    day_of_week        SMALLINT,
    day_of_month       SMALLINT,
    recipient_user_ids UUID[]      NOT NULL DEFAULT '{}',
    active             BOOLEAN     NOT NULL DEFAULT true,
    next_run_on        DATE        NOT NULL,
    last_run_at        TIMESTAMPTZ,
    last_status        VARCHAR(10),
    last_message       TEXT,
    created_by         UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_report_schedules_frequency CHECK (frequency IN ('WEEKLY', 'MONTHLY')),
    CONSTRAINT ck_report_schedules_dow CHECK (day_of_week IS NULL OR day_of_week BETWEEN 1 AND 7),
    CONSTRAINT ck_report_schedules_dom CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
    CONSTRAINT ck_report_schedules_day CHECK (
        (frequency = 'WEEKLY' AND day_of_week IS NOT NULL) OR (frequency = 'MONTHLY' AND day_of_month IS NOT NULL)),
    CONSTRAINT ck_report_schedules_status CHECK (last_status IS NULL OR last_status IN ('SENT', 'PARTIAL', 'FAILED', 'SKIPPED'))
);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due
    ON hrms.report_schedules (tenant_id, active, next_run_on);

ALTER TABLE hrms.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.report_schedules FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hrms' AND tablename = 'report_schedules'
                      AND policyname = 'tenant_isolation_report_schedules') THEN
        CREATE POLICY tenant_isolation_report_schedules ON hrms.report_schedules
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. Employee status history ─────────────────────────────────────────────
-- One row per status, effective from effective_on. The status on a date D is
-- the row with the latest effective_on <= D (ties: the latest recorded_at).
-- Only exits can be dated in the future (a last working day still to come);
-- every other change takes effect on or before today, so today's history
-- always agrees with the status on the employee record.
CREATE TABLE IF NOT EXISTS hrms.employee_status_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    employee_id  UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    from_status  VARCHAR(30),
    status       VARCHAR(30) NOT NULL,
    effective_on DATE        NOT NULL,
    source       VARCHAR(10) NOT NULL DEFAULT 'CHANGE',
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_employee_status_history_source CHECK (source IN ('CREATE', 'CHANGE', 'BACKFILL'))
);
CREATE INDEX IF NOT EXISTS idx_employee_status_history_employee
    ON hrms.employee_status_history (tenant_id, employee_id, effective_on DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_status_history_date
    ON hrms.employee_status_history (tenant_id, effective_on);

ALTER TABLE hrms.employee_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_status_history FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hrms' AND tablename = 'employee_status_history'
                      AND policyname = 'tenant_isolation_employee_status_history') THEN
        CREATE POLICY tenant_isolation_employee_status_history ON hrms.employee_status_history
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- Rebuilds one employee's timeline from the dates on their record, when they
-- have no history yet: joined (on probation when a probation end date after
-- joining is on file, or they are on probation now), confirmed, notice, exit,
-- and any other current status (suspended) from today. Returns rows written.
CREATE OR REPLACE FUNCTION hrms.seed_employee_status_history(p_employee UUID, p_source VARCHAR)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    e         hrms.employees%ROWTYPE;
    today     DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    joined    DATE;
    confirmed DATE;
    leaving   DATE;
    noticed   DATE;
    exit_like BOOLEAN;
    prev      VARCHAR(30) := NULL;
    n         INTEGER := 0;
BEGIN
    SELECT * INTO e FROM hrms.employees WHERE id = p_employee;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    IF EXISTS (SELECT 1 FROM hrms.employee_status_history h WHERE h.employee_id = p_employee) THEN
        RETURN 0;
    END IF;

    exit_like := e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED');
    joined    := COALESCE(e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date, today);
    leaving   := CASE WHEN exit_like THEN GREATEST(joined, COALESCE(e.last_working_day, e.date_of_termination, today)) END;

    -- How they started.
    IF e.employment_status = 'PROBATION' OR (e.probation_end_date IS NOT NULL AND e.probation_end_date > joined) THEN
        INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
             VALUES (e.tenant_id, e.id, NULL, 'PROBATION', joined, p_source);
        prev := 'PROBATION'; n := n + 1;
        IF e.employment_status <> 'PROBATION' THEN
            -- Confirmed on the confirmation (or probation end) date, never
            -- later than today; someone ACTIVE now is always confirmed.
            confirmed := GREATEST(joined, LEAST(COALESCE(e.confirmation_date, e.probation_end_date, today), today));
            IF e.employment_status = 'ACTIVE'
               OR (confirmed > joined
                   AND (e.notice_start_date IS NULL OR confirmed < e.notice_start_date)
                   AND (leaving IS NULL OR confirmed < leaving)) THEN
                INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
                     VALUES (e.tenant_id, e.id, prev, 'ACTIVE', confirmed, p_source);
                prev := 'ACTIVE'; n := n + 1;
            END IF;
        END IF;
    ELSE
        INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
             VALUES (e.tenant_id, e.id, NULL, 'ACTIVE', joined, p_source);
        prev := 'ACTIVE'; n := n + 1;
    END IF;

    -- Serving notice (a start date on file, or on notice now).
    IF e.employment_status = 'NOTICE_PERIOD' OR (exit_like AND e.notice_start_date IS NOT NULL) THEN
        noticed := GREATEST(joined, LEAST(COALESCE(e.notice_start_date, today), today));
        IF leaving IS NULL OR noticed < leaving THEN
            INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
                 VALUES (e.tenant_id, e.id, prev, 'NOTICE_PERIOD', noticed, p_source);
            prev := 'NOTICE_PERIOD'; n := n + 1;
        END IF;
    END IF;

    -- Left, dated by the last working day (it can still be to come).
    IF exit_like THEN
        INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
             VALUES (e.tenant_id, e.id, prev, e.employment_status, leaving, p_source);
        n := n + 1;
    ELSIF e.employment_status NOT IN ('PROBATION', 'ACTIVE', 'NOTICE_PERIOD') THEN
        INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
             VALUES (e.tenant_id, e.id, prev, e.employment_status, GREATEST(joined, today), p_source);
        n := n + 1;
    END IF;
    RETURN n;
END;
$$;

-- Records a status change as it happens. Never blocks the employee write: if
-- the history row can't be written, the change still saves and a warning is
-- logged (the next status change seeds the timeline again).
CREATE OR REPLACE FUNCTION hrms.record_employee_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    eff   DATE;
BEGIN
    BEGIN
        IF TG_OP = 'INSERT' THEN
            PERFORM hrms.seed_employee_status_history(NEW.id, 'CREATE');
            RETURN NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM hrms.employee_status_history h WHERE h.employee_id = NEW.id) THEN
            PERFORM hrms.seed_employee_status_history(NEW.id, 'BACKFILL');
            RETURN NULL;
        END IF;

        IF OLD.employment_status IS NOT DISTINCT FROM NEW.employment_status THEN
            -- Same status, new last working day: move the exit to the new date.
            IF NEW.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED') THEN
                UPDATE hrms.employee_status_history h
                   SET effective_on = COALESCE(NEW.last_working_day, NEW.date_of_termination, today)
                 WHERE h.id = (SELECT x.id FROM hrms.employee_status_history x
                                WHERE x.employee_id = NEW.id AND x.status = NEW.employment_status
                                ORDER BY x.effective_on DESC, x.recorded_at DESC LIMIT 1);
            END IF;
            RETURN NULL;
        END IF;

        eff := CASE
            WHEN NEW.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                THEN COALESCE(NEW.last_working_day, NEW.date_of_termination, today)
            WHEN NEW.employment_status = 'NOTICE_PERIOD'
                THEN LEAST(COALESCE(NEW.notice_start_date, today), today)
            WHEN NEW.employment_status = 'ACTIVE' AND OLD.employment_status = 'PROBATION'
                THEN LEAST(COALESCE(NEW.confirmation_date, today), today)
            ELSE today
        END;
        -- A change recorded now supersedes anything that was still to come
        -- after it (for example a notice withdrawn before it started).
        DELETE FROM hrms.employee_status_history h
         WHERE h.employee_id = NEW.id AND h.effective_on > GREATEST(eff, today);
        INSERT INTO hrms.employee_status_history (tenant_id, employee_id, from_status, status, effective_on, source)
             VALUES (NEW.tenant_id, NEW.id, OLD.employment_status, NEW.employment_status, eff, 'CHANGE');
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'employee_status_history not recorded for employee %: %', NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_status_history_insert ON hrms.employees;
CREATE TRIGGER trg_employees_status_history_insert
    AFTER INSERT ON hrms.employees
    FOR EACH ROW EXECUTE FUNCTION hrms.record_employee_status_change();

DROP TRIGGER IF EXISTS trg_employees_status_history_update ON hrms.employees;
CREATE TRIGGER trg_employees_status_history_update
    AFTER UPDATE OF employment_status, last_working_day ON hrms.employees
    FOR EACH ROW
    WHEN (OLD.employment_status IS DISTINCT FROM NEW.employment_status
          OR OLD.last_working_day IS DISTINCT FROM NEW.last_working_day)
    EXECUTE FUNCTION hrms.record_employee_status_change();

-- Backfill every existing employee, tenant by tenant with the tenant bound, so
-- it works whether or not the role applying this migration bypasses RLS.
DO $$
DECLARE
    t UUID;
BEGIN
    FOR t IN SELECT id FROM platform.tenants LOOP
        PERFORM set_config('app.tenant_id', t::text, true);
        PERFORM hrms.seed_employee_status_history(e.id, 'BACKFILL')
           FROM hrms.employees e
          WHERE e.tenant_id = t;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.report_exports TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.report_schedules TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.employee_status_history TO ut_app;
        GRANT EXECUTE ON FUNCTION hrms.seed_employee_status_history(UUID, VARCHAR) TO ut_app;
        GRANT EXECUTE ON FUNCTION hrms.record_employee_status_change() TO ut_app;
    END IF;
END $$;

-- ── 4. Permissions ────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.report.exports.read_all', 'See everyone''s report downloads', 'hrms',
     'See the whole download history in the Reports Center: who downloaded which report, in which format, with which filters and when. Without it, people see only their own downloads.'),
    ('hrms.report.schedule.manage', 'Schedule report emails', 'hrms',
     'Set up, change, pause and delete weekly or monthly report emails. Each email carries the report as a PDF to the workspace members you pick, and only to people who may open that report themselves. Only give it to people trusted to decide who receives report data.')
ON CONFLICT (code) DO NOTHING;

-- HR runs the reports; OWNER and SUPER_ADMIN hold every permission
-- (OwnerPermissionInvariantCheck refuses to start the app otherwise).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('hrms.report.exports.read_all'), ('hrms.report.schedule.manage')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;
