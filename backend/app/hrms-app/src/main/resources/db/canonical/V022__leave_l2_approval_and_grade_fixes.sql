-- ============================================================================
-- V022 - Leave 2-level approval columns + org.grades description column
-- ============================================================================

-- Add L2 (HR) approval columns to leave_requests
ALTER TABLE leave_mgmt.leave_requests
    ADD COLUMN IF NOT EXISTS l2_approver_id      UUID,
    ADD COLUMN IF NOT EXISTS l2_approver_comment TEXT,
    ADD COLUMN IF NOT EXISTS l2_approved_at      TIMESTAMPTZ;

-- Add PENDING_L2 as a valid status (constraint was added in V014 as a check)
-- Drop and re-create with extended enum values
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'leave_mgmt'
          AND table_name   = 'leave_requests'
          AND constraint_name = 'ck_leave_requests_status'
    ) THEN
        ALTER TABLE leave_mgmt.leave_requests DROP CONSTRAINT ck_leave_requests_status;
    END IF;
END$$;

ALTER TABLE leave_mgmt.leave_requests
    ADD CONSTRAINT ck_leave_requests_status
    CHECK (status IN ('PENDING','PENDING_L2','APPROVED','REJECTED','CANCELLED','ESCALATED'));

-- Add description to org.grades (if not present)
ALTER TABLE org.grades
    ADD COLUMN IF NOT EXISTS description TEXT;

-- Add description and code to org.shifts (both absent from V021)
ALTER TABLE org.shifts
    ADD COLUMN IF NOT EXISTS code        VARCHAR(30),
    ADD COLUMN IF NOT EXISTS description TEXT;

-- version column required by BaseEntity (@Version)
ALTER TABLE org.grades
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE org.employment_types
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE org.shifts
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_addresses
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_identities
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_bank_accounts
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_education
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_experiences
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.employee_dependents
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.onboarding_templates
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- ── Missing columns in V021 tables required by entities ──────────────────────

-- employee_education: V021 has pass_year and grade but missing start_year, is_highest
ALTER TABLE hrms.employee_education
    ADD COLUMN IF NOT EXISTS start_year        INT,
    ADD COLUMN IF NOT EXISTS is_highest        BOOLEAN NOT NULL DEFAULT FALSE;

-- employee_experiences: V021 missing location column
ALTER TABLE hrms.employee_experiences
    ADD COLUMN IF NOT EXISTS location          VARCHAR(150);

-- employee_dependents: V021 missing gender, nominee_percentage
ALTER TABLE hrms.employee_dependents
    ADD COLUMN IF NOT EXISTS gender            VARCHAR(10),
    ADD COLUMN IF NOT EXISTS nominee_percentage INT;

-- onboarding_instances: V021 missing status column
ALTER TABLE hrms.onboarding_instances
    ADD COLUMN IF NOT EXISTS status            VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS';

-- onboarding_tasks: V021 missing updated_at (it has only created_at)
ALTER TABLE hrms.onboarding_tasks
    ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- onboarding_instance_tasks: V021 missing sequence_no, title, owner_role, is_required
ALTER TABLE hrms.onboarding_instance_tasks
    ADD COLUMN IF NOT EXISTS sequence_no       INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS title             VARCHAR(200),
    ADD COLUMN IF NOT EXISTS owner_role        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_required       BOOLEAN NOT NULL DEFAULT TRUE;

-- ── created_by / updated_by columns for BaseEntity audit ─────────────────────
ALTER TABLE org.grades
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE org.employment_types
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE org.shifts
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_addresses
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_identities
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_bank_accounts
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_education
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_experiences
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employee_dependents
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.onboarding_templates
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.onboarding_tasks
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.onboarding_instances
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.onboarding_instance_tasks
    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
