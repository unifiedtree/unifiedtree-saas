-- ============================================================================
-- V028 - Attendance + Leave canonical readiness
-- ----------------------------------------------------------------------------
-- Adds the columns that BaseEntity requires (created_by, updated_by, version,
-- updated_at where absent) to every attendance.* and leave_mgmt.* table, plus
-- business columns whose presence is expected by existing service-layer code
-- but were absent from the canonical schema design.
--
-- Philosophy: prefer IF NOT EXISTS everywhere so this is safe to re-run and
-- composable with any future schema state.
-- ============================================================================

-- ============================================================================
-- SECTION 1: attendance.records (partitioned table)
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓  updated_at ✓
--             created_by ✗  updated_by ✗  version ✗
-- Service also sets: is_regularized, regularization_reason, managed_by_employee_id,
--                    client_event_id, device_id, remarks
-- ============================================================================
ALTER TABLE attendance.records
    ADD COLUMN IF NOT EXISTS created_by            VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by            VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version               BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_regularized        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS regularization_reason TEXT,
    ADD COLUMN IF NOT EXISTS managed_by_employee_id UUID,
    ADD COLUMN IF NOT EXISTS client_event_id       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS device_id             VARCHAR(150),
    ADD COLUMN IF NOT EXISTS remarks               TEXT;

-- ============================================================================
-- SECTION 2: attendance.event_logs (partitioned table)
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- ============================================================================
ALTER TABLE attendance.event_logs
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version     BIGINT NOT NULL DEFAULT 0;

-- ============================================================================
-- SECTION 3: attendance.regularization_requests
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- Service also sets: company_id, department_id, attachment_url
-- ============================================================================
ALTER TABLE attendance.regularization_requests
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by    VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by    VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version       BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS company_id    UUID,
    ADD COLUMN IF NOT EXISTS department_id UUID,
    ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- ============================================================================
-- SECTION 4: attendance.shift_policies
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- ============================================================================
ALTER TABLE attendance.shift_policies
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

-- ============================================================================
-- SECTION 5: attendance.employee_shift_assignments
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- ============================================================================
ALTER TABLE attendance.employee_shift_assignments
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

-- ============================================================================
-- SECTION 6: leave_mgmt.leave_types
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- Entity also has: category, max_consecutive_days, min_notice_days,
--                  is_encashable, applicable_gender, description
-- Note: carry_forward ↔ is_carry_forward_allowed (entity @Column fix)
--       carry_forward_max_days ↔ max_carry_forward_days (entity @Column fix)
-- ============================================================================
ALTER TABLE leave_mgmt.leave_types
    ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by           VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by           VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version              BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS category             VARCHAR(50),
    ADD COLUMN IF NOT EXISTS max_consecutive_days INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_notice_days      INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_encashable        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS applicable_gender    VARCHAR(20),
    ADD COLUMN IF NOT EXISTS description          TEXT;

-- ============================================================================
-- SECTION 7: leave_mgmt.leave_balances
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓  updated_at ✓
--             created_by ✗  updated_by ✗  version ✗
-- ============================================================================
ALTER TABLE leave_mgmt.leave_balances
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

-- ============================================================================
-- SECTION 8: leave_mgmt.leave_requests
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓  updated_at ✓
--             created_by ✗  updated_by ✗  version ✗
-- Entity also has: duration (LeaveDuration enum), cancelled_at
-- Note: approver_comment → decision_note (entity @Column fix)
--       approved_at      → decision_at   (entity @Column fix)
-- ============================================================================
ALTER TABLE leave_mgmt.leave_requests
    ADD COLUMN IF NOT EXISTS created_by   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version      BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration     VARCHAR(30),
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ============================================================================
-- SECTION 9: leave_mgmt.comp_off_balances
-- BaseEntity: id ✓  tenant_id ✓  created_at ✓
--             updated_at ✗  created_by ✗  updated_by ✗  version ✗
-- ============================================================================
ALTER TABLE leave_mgmt.comp_off_balances
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

-- ============================================================================
-- SECTION 10: leave_mgmt.holiday_calendars (safety net — V024 creates this)
-- Entity: company_id, name, holiday_date, year, is_optional, description
--         + BaseEntity audit columns
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_mgmt.holiday_calendars (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    company_id   UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name         VARCHAR(150) NOT NULL,
    holiday_date DATE        NOT NULL,
    year         INT         NOT NULL,
    is_optional  BOOLEAN     NOT NULL DEFAULT FALSE,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      BIGINT      NOT NULL DEFAULT 0,
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255)
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

-- ============================================================================
-- SECTION 11: Grants for newly added columns (hrms_app role)
-- V025 granted table-level DML; new columns in existing tables are covered
-- automatically. Explicit column grants only needed for new tables.
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON leave_mgmt.holiday_calendars TO hrms_app;
  END IF;
END $$;

-- ============================================================================
-- SECTION 12: Verification
-- ============================================================================
DO $$
DECLARE
    col_count INT;
BEGIN
    SELECT count(*) INTO col_count
      FROM information_schema.columns
     WHERE table_schema = 'attendance' AND table_name = 'records'
       AND column_name IN ('created_by', 'updated_by', 'version', 'is_regularized', 'client_event_id');
    RAISE NOTICE 'attendance.records new columns present: % of 5 expected', col_count;

    SELECT count(*) INTO col_count
      FROM information_schema.columns
     WHERE table_schema = 'leave_mgmt' AND table_name = 'leave_types'
       AND column_name IN ('created_by', 'updated_by', 'version', 'description', 'category');
    RAISE NOTICE 'leave_mgmt.leave_types new columns present: % of 5 expected', col_count;

    SELECT count(*) INTO col_count
      FROM information_schema.tables
     WHERE table_schema = 'leave_mgmt' AND table_name = 'holiday_calendars';
    RAISE NOTICE 'leave_mgmt.holiday_calendars exists: %', (col_count = 1);
END $$;
