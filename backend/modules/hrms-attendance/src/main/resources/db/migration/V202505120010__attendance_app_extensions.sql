ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS check_out_method VARCHAR(30),
    ADD COLUMN IF NOT EXISTS check_in_zone_id UUID,
    ADD COLUMN IF NOT EXISTS check_out_zone_id UUID,
    ADD COLUMN IF NOT EXISTS location_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS check_in_zone_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS check_out_zone_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS late_by_minutes INT,
    ADD COLUMN IF NOT EXISTS overtime_minutes INT,
    ADD COLUMN IF NOT EXISTS is_manual_entry BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS managed_by_employee_id UUID,
    ADD COLUMN IF NOT EXISTS manager_note TEXT,
    ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS device_id VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_client_event
    ON attendance_records (tenant_id, client_event_id)
    WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance_event_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    attendance_record_id UUID,
    employee_id UUID NOT NULL,
    company_id UUID NOT NULL,
    department_id UUID,
    branch_id UUID,
    event_date DATE NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    attendance_status VARCHAR(30),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_name VARCHAR(255),
    zone_name VARCHAR(255),
    actor_employee_id UUID,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance_correction_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    company_id UUID NOT NULL,
    department_id UUID,
    attendance_record_id UUID,
    requested_date DATE NOT NULL,
    requested_check_in_at TIMESTAMPTZ,
    requested_check_out_at TIMESTAMPTZ,
    reason TEXT NOT NULL,
    attachment_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    approver_id UUID,
    approver_comment TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS geo_fence_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    branch_id UUID,
    department_id UUID,
    name VARCHAR(150) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters INT NOT NULL DEFAULT 100,
    punch_method VARCHAR(30) NOT NULL DEFAULT 'FACE_RECOGNITION',
    color_hex VARCHAR(20),
    icon_key VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_employee_date
    ON attendance_event_logs (employee_id, event_date, event_at);
CREATE INDEX IF NOT EXISTS idx_attendance_events_company_date
    ON attendance_event_logs (company_id, event_date, event_at);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_employee
    ON attendance_correction_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_company
    ON attendance_correction_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_geo_fence_zones_company
    ON geo_fence_zones (company_id, is_active);
