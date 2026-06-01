-- ============================================================================
-- V007 - attendance schema (PARTITIONED for scale)
-- ============================================================================
-- attendance.records and attendance.event_logs are partitioned by month on
-- attendance_date. At 1M users * 2 punches/day, event_logs would hit ~700M
-- rows/year on a single table - Postgres degrades past ~500M rows. Monthly
-- partitions keep each partition <100M rows and let us drop old data cheaply.
--
-- Partitioning rule: PARTITION BY RANGE (attendance_date) for records,
-- PARTITION BY RANGE (event_at) for event_logs.
-- A pg_cron job (or app boot hook) creates the next 3 months ahead at startup.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE attendance.attendance_type AS ENUM ('OFFICE','WORK_FROM_HOME','HYBRID','FIELD','OUTDOOR_DUTY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE attendance.attendance_status AS ENUM ('PRESENT','ABSENT','LATE','HALF_DAY','ON_LEAVE','WEEKEND','HOLIDAY','PENDING_REGULARIZATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE attendance.check_method AS ENUM ('MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK','GEO_FENCE','API');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Shift policy (catalog table - not partitioned)
CREATE TABLE attendance.shift_policies (
    id                      UUID            PRIMARY KEY,
    tenant_id               UUID            NOT NULL,
    company_id              UUID            NOT NULL,
    name                    VARCHAR(100)    NOT NULL,
    shift_type              VARCHAR(30)     NOT NULL DEFAULT 'FIXED',  -- FIXED | FLEXIBLE | NIGHT
    start_time              TIME            NOT NULL,
    end_time                TIME            NOT NULL,
    grace_period_minutes    INT             NOT NULL DEFAULT 15,
    working_hours_per_day   NUMERIC(4,2)    NOT NULL DEFAULT 8.0,
    overtime_applicable     BOOLEAN         NOT NULL DEFAULT FALSE,
    overtime_multiplier     NUMERIC(4,2)    DEFAULT 1.5,
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_policies_tenant ON attendance.shift_policies(tenant_id);
ALTER TABLE attendance.shift_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shift_policies ON attendance.shift_policies
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Employee-to-shift assignment (for shift roster)
CREATE TABLE attendance.employee_shift_assignments (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    employee_id     UUID            NOT NULL,
    shift_policy_id UUID            NOT NULL REFERENCES attendance.shift_policies(id),
    effective_from  DATE            NOT NULL,
    effective_to    DATE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_assignments_emp ON attendance.employee_shift_assignments(tenant_id, employee_id, effective_from);
ALTER TABLE attendance.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shift_assign ON attendance.employee_shift_assignments
    USING (tenant_id = current_tenant_id());

-- ============================================================================
-- attendance.records - daily attendance summary, PARTITIONED BY RANGE on date
-- ============================================================================
CREATE TABLE attendance.records (
    id                          UUID                            NOT NULL,
    tenant_id                   UUID                            NOT NULL,
    employee_id                 UUID                            NOT NULL,
    attendance_date             DATE                            NOT NULL,
    check_in_at                 TIMESTAMPTZ,
    check_out_at                TIMESTAMPTZ,
    attendance_type             attendance.attendance_type      DEFAULT 'OFFICE',
    attendance_status           attendance.attendance_status    DEFAULT 'PRESENT',
    check_in_method             attendance.check_method,
    check_out_method            attendance.check_method,
    check_in_latitude           DECIMAL(10,7),
    check_in_longitude          DECIMAL(10,7),
    check_out_latitude          DECIMAL(10,7),
    check_out_longitude         DECIMAL(10,7),
    check_in_location_name      VARCHAR(255),
    check_out_location_name     VARCHAR(255),
    check_in_zone_name          VARCHAR(150),
    check_out_zone_name         VARCHAR(150),
    branch_id                   UUID,
    company_id                  UUID,
    department_id               UUID,
    face_confidence_score       NUMERIC(5,4),
    late_by_minutes             INT,
    overtime_minutes            INT,
    work_hours                  NUMERIC(5,2),
    manual_entry                BOOLEAN                         NOT NULL DEFAULT FALSE,
    manual_entry_reason         VARCHAR(255),
    created_at                  TIMESTAMPTZ                     NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ                     NOT NULL DEFAULT now(),

    -- Composite primary key required for partitioned tables - partition key
    -- must appear in the PK. Application uses id+attendance_date for lookups.
    PRIMARY KEY (id, attendance_date)
) PARTITION BY RANGE (attendance_date);

CREATE INDEX idx_attendance_records_tenant_date  ON attendance.records (tenant_id, attendance_date);
CREATE INDEX idx_attendance_records_emp_date     ON attendance.records (tenant_id, employee_id, attendance_date);
CREATE INDEX idx_attendance_records_status       ON attendance.records (tenant_id, attendance_status, attendance_date);
CREATE INDEX idx_attendance_records_branch       ON attendance.records (tenant_id, branch_id, attendance_date);

ALTER TABLE attendance.records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_attendance_records ON attendance.records
    USING (tenant_id = current_tenant_id());

-- Initial partitions: current month + 3 months ahead, plus a catch-all "default"
-- (the app job extends this rolling window monthly).
CREATE TABLE attendance.records_2026_05 PARTITION OF attendance.records FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE attendance.records_2026_06 PARTITION OF attendance.records FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE attendance.records_2026_07 PARTITION OF attendance.records FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE attendance.records_2026_08 PARTITION OF attendance.records FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE attendance.records_default PARTITION OF attendance.records DEFAULT;

-- ============================================================================
-- attendance.event_logs - every check-in / check-out / correction event,
-- PARTITIONED BY RANGE on event_at (timestamp). Higher volume than records.
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE attendance.event_type AS ENUM ('CHECK_IN','CHECK_OUT','BREAK_START','BREAK_END','REGULARIZATION_REQUEST','REGULARIZATION_APPROVED','REGULARIZATION_REJECTED','MANUAL_OVERRIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE attendance.event_logs (
    id                  UUID                        NOT NULL,
    tenant_id           UUID                        NOT NULL,
    employee_id         UUID                        NOT NULL,
    record_id           UUID,
    company_id          UUID,
    department_id       UUID,
    branch_id           UUID,
    event_at            TIMESTAMPTZ                 NOT NULL,
    event_date          DATE                        NOT NULL,
    event_type          attendance.event_type       NOT NULL,
    attendance_status   attendance.attendance_status,
    latitude            DECIMAL(10,7),
    longitude           DECIMAL(10,7),
    location_name       VARCHAR(255),
    zone_name           VARCHAR(150),
    actor_employee_id   UUID,
    note                TEXT,
    created_at          TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_at)
) PARTITION BY RANGE (event_at);

CREATE INDEX idx_event_logs_tenant_date ON attendance.event_logs (tenant_id, event_date);
CREATE INDEX idx_event_logs_emp ON attendance.event_logs (tenant_id, employee_id, event_at DESC);
CREATE INDEX idx_event_logs_type ON attendance.event_logs (tenant_id, event_type, event_at DESC);

ALTER TABLE attendance.event_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_logs ON attendance.event_logs
    USING (tenant_id = current_tenant_id());

CREATE TABLE attendance.event_logs_2026_05 PARTITION OF attendance.event_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE attendance.event_logs_2026_06 PARTITION OF attendance.event_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE attendance.event_logs_2026_07 PARTITION OF attendance.event_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE attendance.event_logs_2026_08 PARTITION OF attendance.event_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE attendance.event_logs_default PARTITION OF attendance.event_logs DEFAULT;

-- ----------------------------------------------------------------------------
-- Regularization requests (not partitioned - low volume per tenant)
CREATE TABLE attendance.regularization_requests (
    id                  UUID            PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    employee_id         UUID            NOT NULL,
    record_id           UUID,
    request_date        DATE            NOT NULL,
    missing_for_date    DATE            NOT NULL,
    requested_check_in  TIMESTAMPTZ,
    requested_check_out TIMESTAMPTZ,
    reason              TEXT            NOT NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
    approver_id         UUID,
    decision_at         TIMESTAMPTZ,
    decision_note       TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_regul_tenant ON attendance.regularization_requests(tenant_id, status, missing_for_date);
ALTER TABLE attendance.regularization_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_regul ON attendance.regularization_requests
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Helper to provision the next month's partition (called from app boot)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION attendance.ensure_monthly_partition(p_year INT, p_month INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    rec_partition_name  TEXT;
    log_partition_name  TEXT;
    range_start         DATE;
    range_end           DATE;
BEGIN
    range_start := make_date(p_year, p_month, 1);
    range_end := range_start + INTERVAL '1 month';
    rec_partition_name := format('records_%s_%s', p_year, lpad(p_month::TEXT, 2, '0'));
    log_partition_name := format('event_logs_%s_%s', p_year, lpad(p_month::TEXT, 2, '0'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS attendance.%I PARTITION OF attendance.records
            FOR VALUES FROM (%L) TO (%L)',
        rec_partition_name, range_start, range_end
    );
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS attendance.%I PARTITION OF attendance.event_logs
            FOR VALUES FROM (%L) TO (%L)',
        log_partition_name, range_start::TIMESTAMPTZ, range_end::TIMESTAMPTZ
    );
END;
$$;

COMMENT ON FUNCTION attendance.ensure_monthly_partition(INT, INT) IS
    'Idempotently creates the monthly partition for attendance.records and attendance.event_logs. App calls this at boot and on a daily cron.';
