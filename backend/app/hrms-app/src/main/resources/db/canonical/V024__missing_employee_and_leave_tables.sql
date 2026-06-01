-- ============================================================================
-- V024 - Tables and columns missing from earlier migrations:
--        hrms.emergency_contacts, hrms.employee_documents,
--        leave_mgmt.holiday_calendars;
--        + hrms.employees columns used by the Employee entity but absent from V006
--        + HR_MANAGER grants for leave.type.write and settings.holidays.write
-- ============================================================================

-- hrms.employees — columns used by the Employee entity (not in WorkforceEmployee / V006)
ALTER TABLE hrms.employees
    ADD COLUMN IF NOT EXISTS personal_email      VARCHAR(255),
    ADD COLUMN IF NOT EXISTS job_title           VARCHAR(150),
    ADD COLUMN IF NOT EXISTS date_of_termination DATE,
    ADD COLUMN IF NOT EXISTS notice_period_days  INT NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS work_location       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS salary_frequency    VARCHAR(30),
    ADD COLUMN IF NOT EXISTS monthly_salary      NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS bank_branch_name    VARCHAR(150),
    ADD COLUMN IF NOT EXISTS face_embedding      BYTEA;

-- ----------------------------------------------------------------------------
-- hrms.emergency_contacts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.emergency_contacts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    relationship    VARCHAR(50),
    phone           VARCHAR(20),
    email           VARCHAR(255),
    is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         BIGINT      NOT NULL DEFAULT 0,
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_tenant ON hrms.emergency_contacts(tenant_id, employee_id);
ALTER TABLE hrms.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.emergency_contacts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'emergency_contacts'
      AND policyname = 'tenant_isolation_emergency_contacts'
  ) THEN
    CREATE POLICY tenant_isolation_emergency_contacts ON hrms.emergency_contacts
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_documents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_documents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    document_type   VARCHAR(50) NOT NULL,
    document_name   VARCHAR(255),
    file_url        TEXT,
    file_size       BIGINT      NOT NULL DEFAULT 0,
    is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
    expires_at      DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         BIGINT      NOT NULL DEFAULT 0,
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_tenant ON hrms.employee_documents(tenant_id, employee_id);
ALTER TABLE hrms.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_documents FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_documents'
      AND policyname = 'tenant_isolation_employee_documents'
  ) THEN
    CREATE POLICY tenant_isolation_employee_documents ON hrms.employee_documents
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- leave_mgmt.holiday_calendars
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_mgmt.holiday_calendars (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    company_id      UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    holiday_date    DATE        NOT NULL,
    year            INT         NOT NULL,
    is_optional     BOOLEAN     NOT NULL DEFAULT FALSE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         BIGINT      NOT NULL DEFAULT 0,
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_holiday_calendars_tenant ON leave_mgmt.holiday_calendars(tenant_id, company_id, year);
ALTER TABLE leave_mgmt.holiday_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.holiday_calendars FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'leave_mgmt' AND tablename = 'holiday_calendars'
      AND policyname = 'tenant_isolation_holiday_calendars'
  ) THEN
    CREATE POLICY tenant_isolation_holiday_calendars ON leave_mgmt.holiday_calendars
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- HR_MANAGER grants: leave.type.write + settings.holidays.write
-- These existed in the catalog (V004) and SUPER_ADMIN received them via V017,
-- but HR_MANAGER was never explicitly granted them.
-- ----------------------------------------------------------------------------
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002', code
  FROM rbac.permissions
 WHERE code IN (
     'leave.type.write',
     'settings.holidays.write'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;
