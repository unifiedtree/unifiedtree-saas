CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    company_id UUID NOT NULL,
    department_id UUID,
    branch_id UUID,
    attendance_date DATE NOT NULL,
    check_in_at TIMESTAMPTZ,
    check_out_at TIMESTAMPTZ,
    attendance_type VARCHAR(30),
    check_in_method VARCHAR(30),
    check_in_latitude DOUBLE PRECISION,
    check_in_longitude DOUBLE PRECISION,
    check_out_latitude DOUBLE PRECISION,
    check_out_longitude DOUBLE PRECISION,
    face_confidence_score DOUBLE PRECISION,
    is_regularized BOOLEAN NOT NULL DEFAULT false,
    regularization_reason TEXT,
    working_hours DOUBLE PRECISION,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_attendance_employee_date UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE TABLE shift_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    shift_type VARCHAR(30),
    start_time TIME,
    end_time TIME,
    grace_period_minutes INT DEFAULT 15,
    working_hours_per_day DOUBLE PRECISION DEFAULT 8.0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE geo_fence_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    branch_id UUID,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    within_fence BOOLEAN NOT NULL,
    distance_meters DOUBLE PRECISION,
    action_taken VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_attendance_employee_date ON attendance_records (employee_id, attendance_date DESC);
CREATE INDEX idx_attendance_dept_date ON attendance_records (department_id, attendance_date);
CREATE INDEX idx_attendance_company_date ON attendance_records (company_id, attendance_date);
CREATE INDEX idx_attendance_tenant ON attendance_records (tenant_id);
CREATE INDEX idx_shift_policies_company ON shift_policies (company_id);
CREATE INDEX idx_geo_fence_audits_employee ON geo_fence_audits (employee_id);
