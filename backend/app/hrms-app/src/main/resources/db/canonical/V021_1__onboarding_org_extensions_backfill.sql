-- ============================================================================
-- V021.1 - Backfill onboarding/org extension tables for databases where
--          version 021 was previously used by a different migration.
--
-- Fresh databases run V021 first and this migration becomes a no-op. Existing
-- Railway databases that already recorded the old V021 run this before V022,
-- so V022 can safely add its extra columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- org.grades
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org.grades (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID            NOT NULL,
    company_id  UUID            NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    code        VARCHAR(20)     NOT NULL,
    name        VARCHAR(100)    NOT NULL,
    level       INT             NOT NULL DEFAULT 0,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_grade_tenant_code UNIQUE (tenant_id, company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_grades_tenant ON org.grades(tenant_id, company_id);
ALTER TABLE org.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.grades FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'org' AND tablename = 'grades'
      AND policyname = 'tenant_isolation_grades'
  ) THEN
    CREATE POLICY tenant_isolation_grades ON org.grades
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- org.employment_types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org.employment_types (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID         NOT NULL,
    company_id            UUID         NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name                  VARCHAR(100) NOT NULL,
    code                  VARCHAR(30)  NOT NULL,
    is_payroll_eligible   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_system             BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_emp_type_tenant_code UNIQUE (tenant_id, company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_emp_types_tenant ON org.employment_types(tenant_id, company_id);
ALTER TABLE org.employment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.employment_types FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'org' AND tablename = 'employment_types'
      AND policyname = 'tenant_isolation_emp_types'
  ) THEN
    CREATE POLICY tenant_isolation_emp_types ON org.employment_types
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- org.shifts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org.shifts (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL,
    company_id        UUID         NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    start_time        TIME         NOT NULL,
    end_time          TIME         NOT NULL,
    break_minutes     INT          NOT NULL DEFAULT 30,
    grace_minutes     INT          NOT NULL DEFAULT 10,
    days_bitmask      INT          NOT NULL DEFAULT 62,
    is_night_shift    BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_shift_tenant_name UNIQUE (tenant_id, company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant ON org.shifts(tenant_id, company_id);
ALTER TABLE org.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.shifts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'org' AND tablename = 'shifts'
      AND policyname = 'tenant_isolation_shifts'
  ) THEN
    CREATE POLICY tenant_isolation_shifts ON org.shifts
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_addresses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_addresses (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    address_type    VARCHAR(20) NOT NULL DEFAULT 'CURRENT',
    line1           VARCHAR(255),
    line2           VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(50) DEFAULT 'India',
    pincode         VARCHAR(15),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_employee_address_type UNIQUE (employee_id, address_type)
);
CREATE INDEX IF NOT EXISTS idx_emp_addresses_tenant ON hrms.employee_addresses(tenant_id, employee_id);
ALTER TABLE hrms.employee_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_addresses FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_addresses'
      AND policyname = 'tenant_isolation_emp_addresses'
  ) THEN
    CREATE POLICY tenant_isolation_emp_addresses ON hrms.employee_addresses
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_identities
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_identities (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID        NOT NULL,
    employee_id               UUID        NOT NULL UNIQUE REFERENCES hrms.employees(id) ON DELETE CASCADE,
    pan_encrypted             TEXT,
    aadhaar_last4             VARCHAR(4),
    aadhaar_encrypted         TEXT,
    uan                       VARCHAR(30),
    esic_number               VARCHAR(30),
    passport_number_encrypted TEXT,
    passport_expiry           DATE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_identities_tenant ON hrms.employee_identities(tenant_id, employee_id);
ALTER TABLE hrms.employee_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_identities FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_identities'
      AND policyname = 'tenant_isolation_emp_identities'
  ) THEN
    CREATE POLICY tenant_isolation_emp_identities ON hrms.employee_identities
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_bank_accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_bank_accounts (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID         NOT NULL,
    employee_id              UUID         NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    account_number_encrypted TEXT         NOT NULL,
    account_number_last4     VARCHAR(4)   NOT NULL,
    ifsc_code                VARCHAR(15)  NOT NULL,
    bank_name                VARCHAR(100),
    branch_name              VARCHAR(100),
    account_holder_name      VARCHAR(150) NOT NULL,
    is_primary               BOOLEAN      NOT NULL DEFAULT TRUE,
    is_verified              BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_bank_tenant ON hrms.employee_bank_accounts(tenant_id, employee_id);
ALTER TABLE hrms.employee_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_bank_accounts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_bank_accounts'
      AND policyname = 'tenant_isolation_emp_bank'
  ) THEN
    CREATE POLICY tenant_isolation_emp_bank ON hrms.employee_bank_accounts
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_education
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_education (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    employee_id     UUID         NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    degree          VARCHAR(100) NOT NULL,
    field_of_study  VARCHAR(150),
    institution     VARCHAR(200),
    pass_year       INT,
    grade           VARCHAR(20),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_education_tenant ON hrms.employee_education(tenant_id, employee_id);
ALTER TABLE hrms.employee_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_education FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_education'
      AND policyname = 'tenant_isolation_emp_education'
  ) THEN
    CREATE POLICY tenant_isolation_emp_education ON hrms.employee_education
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_experiences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_experiences (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    employee_id     UUID         NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    company_name    VARCHAR(200) NOT NULL,
    job_title       VARCHAR(150),
    start_date      DATE,
    end_date        DATE,
    is_current      BOOLEAN      NOT NULL DEFAULT FALSE,
    description     TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_experience_tenant ON hrms.employee_experiences(tenant_id, employee_id);
ALTER TABLE hrms.employee_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_experiences FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_experiences'
      AND policyname = 'tenant_isolation_emp_experience'
  ) THEN
    CREATE POLICY tenant_isolation_emp_experience ON hrms.employee_experiences
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.employee_dependents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.employee_dependents (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    employee_id     UUID         NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    relationship    VARCHAR(50),
    date_of_birth   DATE,
    is_nominee      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_dependents_tenant ON hrms.employee_dependents(tenant_id, employee_id);
ALTER TABLE hrms.employee_dependents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_dependents FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'employee_dependents'
      AND policyname = 'tenant_isolation_emp_dependents'
  ) THEN
    CREATE POLICY tenant_isolation_emp_dependents ON hrms.employee_dependents
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.onboarding_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.onboarding_templates (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    company_id     UUID         NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name           VARCHAR(150) NOT NULL,
    description    TEXT,
    designation_id UUID         REFERENCES hrms.designations(id) ON DELETE SET NULL,
    department_id  UUID         REFERENCES hrms.departments(id) ON DELETE SET NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_templates_tenant ON hrms.onboarding_templates(tenant_id, company_id);
ALTER TABLE hrms.onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.onboarding_templates FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'onboarding_templates'
      AND policyname = 'tenant_isolation_onboarding_templates'
  ) THEN
    CREATE POLICY tenant_isolation_onboarding_templates ON hrms.onboarding_templates
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.onboarding_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.onboarding_tasks (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    template_id     UUID         NOT NULL REFERENCES hrms.onboarding_templates(id) ON DELETE CASCADE,
    sequence_no     INT          NOT NULL DEFAULT 0,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    owner_role      VARCHAR(50),
    due_offset_days INT          NOT NULL DEFAULT 1,
    is_required     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_template ON hrms.onboarding_tasks(tenant_id, template_id);
ALTER TABLE hrms.onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.onboarding_tasks FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'onboarding_tasks'
      AND policyname = 'tenant_isolation_onboarding_tasks'
  ) THEN
    CREATE POLICY tenant_isolation_onboarding_tasks ON hrms.onboarding_tasks
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.onboarding_instances
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.onboarding_instances (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    employee_id  UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    template_id  UUID        NOT NULL REFERENCES hrms.onboarding_templates(id),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_instances_tenant ON hrms.onboarding_instances(tenant_id, employee_id);
ALTER TABLE hrms.onboarding_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.onboarding_instances FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'onboarding_instances'
      AND policyname = 'tenant_isolation_onboarding_instances'
  ) THEN
    CREATE POLICY tenant_isolation_onboarding_instances ON hrms.onboarding_instances
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- hrms.onboarding_instance_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hrms.onboarding_instance_tasks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    instance_id  UUID        NOT NULL REFERENCES hrms.onboarding_instances(id) ON DELETE CASCADE,
    task_id      UUID        NOT NULL REFERENCES hrms.onboarding_tasks(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    due_on       DATE,
    completed_at TIMESTAMPTZ,
    completed_by UUID,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_instance_task UNIQUE (instance_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_instance_tasks ON hrms.onboarding_instance_tasks(tenant_id, instance_id);
ALTER TABLE hrms.onboarding_instance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.onboarding_instance_tasks FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'hrms' AND tablename = 'onboarding_instance_tasks'
      AND policyname = 'tenant_isolation_onboarding_inst_tasks'
  ) THEN
    CREATE POLICY tenant_isolation_onboarding_inst_tasks ON hrms.onboarding_instance_tasks
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;
