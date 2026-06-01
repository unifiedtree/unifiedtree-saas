-- =============================================================================
-- MODULE: hrms-leave
-- Tables: leave_types, leave_balances, leave_requests, holiday_calendars
-- Purpose: Leave policy definition, balance tracking, and approval workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: leave_types
-- Defines the leave policies available in a company.
-- category: EARNED | SICK | CASUAL | MATERNITY | PATERNITY | BEREAVEMENT | SABBATICAL | OTHER
-- applicable_gender: NULL = all genders; 'FEMALE' = maternity-only types, etc.
-- -----------------------------------------------------------------------------
CREATE TABLE leave_types (
    id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL,
    company_id               UUID          NOT NULL,  -- → companies.id
    name                     VARCHAR(100)  NOT NULL,
    code                     VARCHAR(30)   NOT NULL,  -- e.g. ANNUAL, SICK, CASUAL — unique per company
    category                 VARCHAR(50),              -- EARNED | SICK | CASUAL | MATERNITY | PATERNITY | BEREAVEMENT | SABBATICAL | OTHER
    annual_entitlement       DOUBLE PRECISION NOT NULL,
    max_consecutive_days     INT           DEFAULT 0,  -- 0 = no limit
    min_notice_days          INT           DEFAULT 0,  -- minimum advance notice required
    is_carry_forward_allowed BOOLEAN       DEFAULT false,
    max_carry_forward_days   INT           DEFAULT 0,
    is_encashable            BOOLEAN       DEFAULT false,
    is_paid_leave            BOOLEAN       DEFAULT true,
    is_active                BOOLEAN       DEFAULT true,
    applicable_gender        VARCHAR(20),              -- NULL = all; FEMALE | MALE | OTHER
    description              TEXT,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by               VARCHAR(255),
    updated_by               VARCHAR(255),
    version                  BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_type_company_code UNIQUE (tenant_id, company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_company ON leave_types (company_id);

COMMENT ON COLUMN leave_types.applicable_gender IS 'NULL = applies to all genders. Set FEMALE for maternity, MALE for paternity.';
COMMENT ON COLUMN leave_types.code              IS 'Short identifier used in payroll and reports (e.g. ANNUAL, SICK, CASUAL).';

-- -----------------------------------------------------------------------------
-- TABLE: leave_balances
-- Current leave balance per employee per leave_type per year.
-- available = total_entitlement + carry_forward - used - pending  (computed in app)
-- One row per (tenant_id, employee_id, leave_type_id, year).
-- -----------------------------------------------------------------------------
CREATE TABLE leave_balances (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    employee_id       UUID          NOT NULL,  -- → employees.id
    leave_type_id     UUID          NOT NULL REFERENCES leave_types(id),
    year              INT           NOT NULL,
    total_entitlement DOUBLE PRECISION NOT NULL DEFAULT 0,
    used              DOUBLE PRECISION NOT NULL DEFAULT 0,
    pending           DOUBLE PRECISION NOT NULL DEFAULT 0,  -- sum of PENDING requests
    carry_forward     DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_balance UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances (employee_id, year);

COMMENT ON COLUMN leave_balances.pending IS 'Days blocked by open PENDING requests. Freed when request is REJECTED or CANCELLED.';

-- -----------------------------------------------------------------------------
-- TABLE: leave_requests
-- A single leave application.
-- duration: FULL_DAY | FIRST_HALF | SECOND_HALF
-- status:   PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN
-- total_days: business days (excluding holidays/weekends) — computed by the app.
-- -----------------------------------------------------------------------------
CREATE TABLE leave_requests (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    employee_id         UUID          NOT NULL,  -- → employees.id (applicant)
    leave_type_id       UUID          NOT NULL REFERENCES leave_types(id),
    approver_id         UUID,                    -- → employees.id (manager who approves)
    start_date          DATE          NOT NULL,
    end_date            DATE          NOT NULL,
    duration            VARCHAR(30),             -- FULL_DAY | FIRST_HALF | SECOND_HALF
    total_days          DOUBLE PRECISION NOT NULL,
    reason              TEXT,
    status              VARCHAR(30)   NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN
    approver_comment    TEXT,
    approved_at         TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by          VARCHAR(255),
    updated_by          VARCHAR(255),
    version             BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_approver ON leave_requests (approver_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: holiday_calendars
-- Public and optional holidays for a company in a given year.
-- is_optional: true = employee may choose to take it; false = mandatory public holiday.
-- -----------------------------------------------------------------------------
CREATE TABLE holiday_calendars (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    company_id   UUID          NOT NULL,  -- → companies.id
    name         VARCHAR(150)  NOT NULL,  -- e.g. 'Republic Day', 'Diwali'
    holiday_date DATE          NOT NULL,
    year         INT           NOT NULL,
    is_optional  BOOLEAN       DEFAULT false,
    description  TEXT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_holidays_company_year ON holiday_calendars (company_id, year);
