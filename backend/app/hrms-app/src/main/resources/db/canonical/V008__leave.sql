-- ============================================================================
-- V008 - leave_mgmt schema: leave types, balances, requests
-- ============================================================================
-- Schema is named leave_mgmt because "leave" is a reserved word in some
-- SQL contexts and trips up tools.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE leave_mgmt.leave_request_status AS ENUM (
        'DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','WITHDRAWN'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
CREATE TABLE leave_mgmt.leave_types (
    id                      UUID            PRIMARY KEY,
    tenant_id               UUID            NOT NULL,
    company_id              UUID            NOT NULL,
    name                    VARCHAR(100)    NOT NULL,
    code                    VARCHAR(30)     NOT NULL,
    annual_entitlement      NUMERIC(5,2)    NOT NULL DEFAULT 0,
    is_paid_leave           BOOLEAN         NOT NULL DEFAULT TRUE,
    accrual_frequency       VARCHAR(20)     DEFAULT 'YEARLY',     -- YEARLY | MONTHLY | QUARTERLY
    accrual_unit            NUMERIC(5,2)    DEFAULT 0,
    carry_forward           BOOLEAN         NOT NULL DEFAULT FALSE,
    carry_forward_max_days  NUMERIC(5,2),
    requires_attachment_after_days NUMERIC(5,2),
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_leave_type_tenant_code UNIQUE (tenant_id, company_id, code)
);

CREATE INDEX idx_leave_types_tenant ON leave_mgmt.leave_types(tenant_id);
ALTER TABLE leave_mgmt.leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_types ON leave_mgmt.leave_types
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE leave_mgmt.leave_balances (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    employee_id     UUID            NOT NULL,
    leave_type_id   UUID            NOT NULL REFERENCES leave_mgmt.leave_types(id) ON DELETE CASCADE,
    year            INT             NOT NULL,
    total_entitlement NUMERIC(5,2)  NOT NULL DEFAULT 0,
    accrued         NUMERIC(5,2)    NOT NULL DEFAULT 0,
    used            NUMERIC(5,2)    NOT NULL DEFAULT 0,
    pending         NUMERIC(5,2)    NOT NULL DEFAULT 0,
    carry_forward   NUMERIC(5,2)    NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_leave_balance UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE INDEX idx_leave_balances_emp ON leave_mgmt.leave_balances(tenant_id, employee_id, year);
ALTER TABLE leave_mgmt.leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_balances ON leave_mgmt.leave_balances
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE leave_mgmt.leave_requests (
    id              UUID                                PRIMARY KEY,
    tenant_id       UUID                                NOT NULL,
    employee_id     UUID                                NOT NULL,
    leave_type_id   UUID                                NOT NULL REFERENCES leave_mgmt.leave_types(id),
    start_date      DATE                                NOT NULL,
    end_date        DATE                                NOT NULL,
    half_day        BOOLEAN                             NOT NULL DEFAULT FALSE,
    half_day_part   VARCHAR(10),                        -- FIRST_HALF | SECOND_HALF
    total_days      NUMERIC(5,2)                        NOT NULL,
    reason          TEXT,
    attachment_url  VARCHAR(500),
    status          leave_mgmt.leave_request_status     NOT NULL DEFAULT 'PENDING',
    approver_id     UUID,
    decision_at     TIMESTAMPTZ,
    decision_note   TEXT,
    cancellation_reason TEXT,
    created_at      TIMESTAMPTZ                         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ                         NOT NULL DEFAULT now(),

    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_emp ON leave_mgmt.leave_requests(tenant_id, employee_id, start_date DESC);
CREATE INDEX idx_leave_requests_status ON leave_mgmt.leave_requests(tenant_id, status);

ALTER TABLE leave_mgmt.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_requests ON leave_mgmt.leave_requests
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Comp-off balances (separate, per client spec "Comp-Offs" column)
CREATE TABLE leave_mgmt.comp_off_balances (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    employee_id     UUID            NOT NULL,
    earned_for_date DATE            NOT NULL,
    days            NUMERIC(5,2)    NOT NULL DEFAULT 1.0,
    expires_on      DATE,
    used_in_request_id UUID         REFERENCES leave_mgmt.leave_requests(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_comp_off_emp ON leave_mgmt.comp_off_balances(tenant_id, employee_id) WHERE used_in_request_id IS NULL;
ALTER TABLE leave_mgmt.comp_off_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_comp_off ON leave_mgmt.comp_off_balances
    USING (tenant_id = current_tenant_id());
