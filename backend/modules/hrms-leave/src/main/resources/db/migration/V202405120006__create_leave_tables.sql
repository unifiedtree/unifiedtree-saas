CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(30) NOT NULL,
    category VARCHAR(50),
    annual_entitlement DOUBLE PRECISION NOT NULL,
    max_consecutive_days INT DEFAULT 0,
    min_notice_days INT DEFAULT 0,
    is_carry_forward_allowed BOOLEAN DEFAULT false,
    max_carry_forward_days INT DEFAULT 0,
    is_encashable BOOLEAN DEFAULT false,
    is_paid_leave BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    applicable_gender VARCHAR(20),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_type_company_code UNIQUE (tenant_id, company_id, code)
);

CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    year INT NOT NULL,
    total_entitlement DOUBLE PRECISION NOT NULL DEFAULT 0,
    used DOUBLE PRECISION NOT NULL DEFAULT 0,
    pending DOUBLE PRECISION NOT NULL DEFAULT 0,
    carry_forward DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_balance UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    approver_id UUID,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration VARCHAR(30),
    total_days DOUBLE PRECISION NOT NULL,
    reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    approver_comment TEXT,
    approved_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE holiday_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    holiday_date DATE NOT NULL,
    year INT NOT NULL,
    is_optional BOOLEAN DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_leave_balances_employee ON leave_balances (employee_id, year);
CREATE INDEX idx_leave_requests_employee ON leave_requests (employee_id, status);
CREATE INDEX idx_leave_requests_approver ON leave_requests (approver_id, status);
CREATE INDEX idx_leave_types_company ON leave_types (company_id);
CREATE INDEX idx_holidays_company_year ON holiday_calendars (company_id, year);
