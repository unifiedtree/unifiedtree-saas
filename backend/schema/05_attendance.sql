-- =============================================================================
-- MODULE: hrms-attendance
-- Tables: attendance_records, attendance_event_logs, attendance_correction_requests,
--         geo_fence_zones, shift_policies, geo_fence_audits
-- Purpose: Daily attendance tracking with face-recognition, geo-fencing,
--          manager corrections, mobile dashboards, and sync-safe punch events.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: attendance_records
-- Immutable record of a single work-day for one employee.
-- check_in_method/check_out_method: FACE | GEO | MANUAL | BIOMETRIC | QR
-- attendance_type: PRESENT | ABSENT | HALF_DAY | WFH | ON_DUTY | HOLIDAY | WEEKLY_OFF
-- attendance_status: CHECKED_IN | CHECKED_OUT | MISSED_CHECKOUT | REGULARIZED | REJECTED
-- is_regularized: HR/manager overrode the original status.
-- working_hours: computed decimal hours, e.g. 8.5.
-- face_confidence_score: 0.0-1.0 from face-recognition model.
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_records (
    id                     UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID             NOT NULL,
    employee_id            UUID             NOT NULL,   -- employees.id
    company_id             UUID             NOT NULL,   -- companies.id
    department_id          UUID,                        -- departments.id snapshot
    branch_id              UUID,                        -- branches.id
    attendance_date        DATE             NOT NULL,
    check_in_at            TIMESTAMPTZ,
    check_out_at           TIMESTAMPTZ,
    attendance_type        VARCHAR(30),                 -- PRESENT | ABSENT | HALF_DAY | WFH | ON_DUTY | HOLIDAY | WEEKLY_OFF
    attendance_status      VARCHAR(30),                 -- CHECKED_IN | CHECKED_OUT | MISSED_CHECKOUT | REGULARIZED | REJECTED
    check_in_method        VARCHAR(30),                 -- FACE | GEO | MANUAL | BIOMETRIC | QR
    check_out_method       VARCHAR(30),                 -- FACE | GEO | MANUAL | BIOMETRIC | QR
    check_in_latitude      DOUBLE PRECISION,
    check_in_longitude     DOUBLE PRECISION,
    check_out_latitude     DOUBLE PRECISION,
    check_out_longitude    DOUBLE PRECISION,
    check_in_zone_id       UUID,
    check_out_zone_id      UUID,
    location_name          VARCHAR(255),
    check_in_zone_name     VARCHAR(255),
    check_out_zone_name    VARCHAR(255),
    face_confidence_score  DOUBLE PRECISION,            -- 0.0-1.0; null if not FACE method
    late_by_minutes        INT,
    overtime_minutes       INT,
    is_manual_entry        BOOLEAN          NOT NULL DEFAULT false,
    managed_by_employee_id UUID,
    manager_note           TEXT,
    client_event_id        VARCHAR(120),
    device_id              VARCHAR(120),
    is_regularized         BOOLEAN          NOT NULL DEFAULT false,
    regularization_reason  TEXT,
    working_hours          DOUBLE PRECISION,
    remarks                TEXT,
    created_at             TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT           NOT NULL DEFAULT 0,
    CONSTRAINT uq_attendance_employee_date UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records (employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_dept_date     ON attendance_records (department_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_company_date  ON attendance_records (company_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant        ON attendance_records (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_client_event
    ON attendance_records (tenant_id, client_event_id)
    WHERE client_event_id IS NOT NULL;

COMMENT ON COLUMN attendance_records.department_id         IS 'Snapshotted at check-in time. Preserved even if employee transfers department later.';
COMMENT ON COLUMN attendance_records.face_confidence_score IS '0.0-1.0 from face-rec model. Threshold for acceptance configured in company settings.';
COMMENT ON COLUMN attendance_records.is_regularized        IS 'True when HR/manager overrode the system-recorded status post-facto.';

-- -----------------------------------------------------------------------------
-- TABLE: attendance_event_logs
-- Chronological activity stream for manager/admin dashboards and mobile sync.
-- event_type: CHECK_IN | CHECK_OUT | MANUAL_ENTRY | CORRECTION_REQUESTED |
--             CORRECTION_APPROVED | CORRECTION_REJECTED | MISSED_CHECKOUT
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_event_logs (
    id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID             NOT NULL,
    attendance_record_id UUID,
    employee_id          UUID             NOT NULL,
    company_id           UUID             NOT NULL,
    department_id        UUID,
    branch_id            UUID,
    event_date           DATE             NOT NULL,
    event_at             TIMESTAMPTZ      NOT NULL,
    event_type           VARCHAR(50)      NOT NULL,
    attendance_status    VARCHAR(30),
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    location_name        VARCHAR(255),
    zone_name            VARCHAR(255),
    actor_employee_id    UUID,
    note                 TEXT,
    created_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_employee_date
    ON attendance_event_logs (employee_id, event_date, event_at);
CREATE INDEX IF NOT EXISTS idx_attendance_events_company_date
    ON attendance_event_logs (company_id, event_date, event_at);

-- -----------------------------------------------------------------------------
-- TABLE: attendance_correction_requests
-- Employee-submitted attendance correction workflow for manager/admin approval.
-- status: PENDING | APPROVED | REJECTED
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_correction_requests (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    employee_id            UUID          NOT NULL,
    company_id             UUID          NOT NULL,
    department_id          UUID,
    attendance_record_id   UUID,
    requested_date         DATE          NOT NULL,
    requested_check_in_at  TIMESTAMPTZ,
    requested_check_out_at TIMESTAMPTZ,
    reason                 TEXT          NOT NULL,
    attachment_url         TEXT,
    status                 VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
    approver_id            UUID,
    approver_comment       TEXT,
    decided_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_employee
    ON attendance_correction_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_company
    ON attendance_correction_requests (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: geo_fence_zones
-- Named punch zones for branches/departments, used by mobile maps and validation.
-- -----------------------------------------------------------------------------
CREATE TABLE geo_fence_zones (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL,
    company_id      UUID             NOT NULL,
    branch_id       UUID,
    department_id   UUID,
    name            VARCHAR(150)     NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    radius_meters   INT              NOT NULL DEFAULT 100,
    punch_method    VARCHAR(30)      NOT NULL DEFAULT 'FACE_RECOGNITION',
    color_hex       VARCHAR(20),
    icon_key        VARCHAR(50),
    is_active       BOOLEAN          NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geo_fence_zones_company
    ON geo_fence_zones (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: shift_policies
-- Defines working hours for a company.
-- shift_type: FIXED | FLEXIBLE | ROTATIONAL | NIGHT
-- -----------------------------------------------------------------------------
CREATE TABLE shift_policies (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    company_id            UUID          NOT NULL,  -- companies.id
    name                  VARCHAR(100)  NOT NULL,
    shift_type            VARCHAR(30),             -- FIXED | FLEXIBLE | ROTATIONAL | NIGHT
    start_time            TIME,                    -- e.g. 09:00
    end_time              TIME,                    -- e.g. 18:00
    grace_period_minutes  INT           DEFAULT 15,
    working_hours_per_day DOUBLE PRECISION DEFAULT 8.0,
    is_active             BOOLEAN       NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shift_policies_company ON shift_policies (company_id);

-- -----------------------------------------------------------------------------
-- TABLE: geo_fence_audits
-- Logs every geo-fence evaluation event, whether the check-in location was
-- inside or outside the branch boundary.
-- action_taken: CHECKIN_ALLOWED | WFH_PROMPTED | DENIED
-- -----------------------------------------------------------------------------
CREATE TABLE geo_fence_audits (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL,
    employee_id     UUID             NOT NULL,  -- employees.id
    branch_id       UUID,                        -- branches.id
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    within_fence    BOOLEAN          NOT NULL,
    distance_meters DOUBLE PRECISION,
    action_taken    VARCHAR(50),                 -- CHECKIN_ALLOWED | WFH_PROMPTED | DENIED
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geo_fence_audits_employee ON geo_fence_audits (employee_id);
CREATE INDEX IF NOT EXISTS idx_geo_fence_audits_branch   ON geo_fence_audits (branch_id);
