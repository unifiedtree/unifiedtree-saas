-- ============================================================================
-- V021 - Org extensions (grades, employment_types, shifts) +
--        Employee profile sections (address, identity, bank, education,
--        experience, dependent) + Onboarding (templates, tasks, instances)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- org.grades
-- ----------------------------------------------------------------------------
CREATE TABLE org.grades (
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
CREATE INDEX idx_grades_tenant ON org.grades(tenant_id, company_id);
ALTER TABLE org.grades ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_grades ON org.grades USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- org.employment_types
-- ----------------------------------------------------------------------------
CREATE TABLE org.employment_types (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    company_id            UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name                  VARCHAR(100) NOT NULL,
    code                  VARCHAR(30)  NOT NULL,
    is_payroll_eligible   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_system             BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_emp_type_tenant_code UNIQUE (tenant_id, company_id, code)
);
CREATE INDEX idx_emp_types_tenant ON org.employment_types(tenant_id, company_id);
ALTER TABLE org.employment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_types ON org.employment_types USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- org.shifts
-- ----------------------------------------------------------------------------
CREATE TABLE org.shifts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    company_id        UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    start_time        TIME        NOT NULL,
    end_time          TIME        NOT NULL,
    break_minutes     INT         NOT NULL DEFAULT 30,
    grace_minutes     INT         NOT NULL DEFAULT 10,
    days_bitmask      INT         NOT NULL DEFAULT 62,  -- Mon-Fri = 0b0111110
    is_night_shift    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shift_tenant_name UNIQUE (tenant_id, company_id, name)
);
CREATE INDEX idx_shifts_tenant ON org.shifts(tenant_id, company_id);
ALTER TABLE org.shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shifts ON org.shifts USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_addresses
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_addresses (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    address_type    VARCHAR(20) NOT NULL DEFAULT 'CURRENT',  -- CURRENT | PERMANENT
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
CREATE INDEX idx_emp_addresses_tenant ON hrms.employee_addresses(tenant_id, employee_id);
ALTER TABLE hrms.employee_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_addresses ON hrms.employee_addresses USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_identities  (PII — columns stored as application-encrypted ciphertext)
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_identities (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL,
    employee_id             UUID        NOT NULL UNIQUE REFERENCES hrms.employees(id) ON DELETE CASCADE,
    pan_encrypted           TEXT,                   -- AES-256-GCM, base64
    aadhaar_last4           VARCHAR(4),             -- plain (for display)
    aadhaar_encrypted       TEXT,                   -- AES-256-GCM, base64
    uan                     VARCHAR(30),
    esic_number             VARCHAR(30),
    passport_number_encrypted TEXT,                 -- AES-256-GCM, base64
    passport_expiry         DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_identities_tenant ON hrms.employee_identities(tenant_id, employee_id);
ALTER TABLE hrms.employee_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_identities ON hrms.employee_identities USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_bank_accounts  (PII — encrypted)
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_bank_accounts (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID        NOT NULL,
    employee_id                 UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    account_number_encrypted    TEXT        NOT NULL,   -- AES-256-GCM, base64
    account_number_last4        VARCHAR(4)  NOT NULL,   -- plain (for display)
    ifsc_code                   VARCHAR(15) NOT NULL,
    bank_name                   VARCHAR(100),
    branch_name                 VARCHAR(100),
    account_holder_name         VARCHAR(150) NOT NULL,
    is_primary                  BOOLEAN     NOT NULL DEFAULT TRUE,
    is_verified                 BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_bank_tenant ON hrms.employee_bank_accounts(tenant_id, employee_id);
ALTER TABLE hrms.employee_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_bank ON hrms.employee_bank_accounts USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_education
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_education (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    degree          VARCHAR(100) NOT NULL,
    field_of_study  VARCHAR(150),
    institution     VARCHAR(200),
    pass_year       INT,
    grade           VARCHAR(20),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_education_tenant ON hrms.employee_education(tenant_id, employee_id);
ALTER TABLE hrms.employee_education ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_education ON hrms.employee_education USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_experiences
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_experiences (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    company_name    VARCHAR(200) NOT NULL,
    job_title       VARCHAR(150),
    start_date      DATE,
    end_date        DATE,
    is_current      BOOLEAN     NOT NULL DEFAULT FALSE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_experience_tenant ON hrms.employee_experiences(tenant_id, employee_id);
ALTER TABLE hrms.employee_experiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_experience ON hrms.employee_experiences USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.employee_dependents
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employee_dependents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    relationship    VARCHAR(50),
    date_of_birth   DATE,
    is_nominee      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_dependents_tenant ON hrms.employee_dependents(tenant_id, employee_id);
ALTER TABLE hrms.employee_dependents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emp_dependents ON hrms.employee_dependents USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.onboarding_templates
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.onboarding_templates (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    company_id          UUID        NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name                VARCHAR(150) NOT NULL,
    description         TEXT,
    designation_id      UUID        REFERENCES hrms.designations(id) ON DELETE SET NULL,
    department_id       UUID        REFERENCES hrms.departments(id) ON DELETE SET NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_templates_tenant ON hrms.onboarding_templates(tenant_id, company_id);
ALTER TABLE hrms.onboarding_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onboarding_templates ON hrms.onboarding_templates USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.onboarding_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.onboarding_tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    template_id     UUID        NOT NULL REFERENCES hrms.onboarding_templates(id) ON DELETE CASCADE,
    sequence_no     INT         NOT NULL DEFAULT 0,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    owner_role      VARCHAR(50),            -- HR | MANAGER | EMPLOYEE | IT
    due_offset_days INT         NOT NULL DEFAULT 1,
    is_required     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_tasks_template ON hrms.onboarding_tasks(tenant_id, template_id);
ALTER TABLE hrms.onboarding_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onboarding_tasks ON hrms.onboarding_tasks USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.onboarding_instances  (one per employee, created on hire)
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.onboarding_instances (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    template_id     UUID        NOT NULL REFERENCES hrms.onboarding_templates(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_instances_tenant ON hrms.onboarding_instances(tenant_id, employee_id);
ALTER TABLE hrms.onboarding_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onboarding_instances ON hrms.onboarding_instances USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- hrms.onboarding_instance_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE hrms.onboarding_instance_tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    instance_id     UUID        NOT NULL REFERENCES hrms.onboarding_instances(id) ON DELETE CASCADE,
    task_id         UUID        NOT NULL REFERENCES hrms.onboarding_tasks(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING | DONE | SKIPPED
    due_on          DATE,
    completed_at    TIMESTAMPTZ,
    completed_by    UUID,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_instance_task UNIQUE (instance_id, task_id)
);
CREATE INDEX idx_onboarding_instance_tasks ON hrms.onboarding_instance_tasks(tenant_id, instance_id);
ALTER TABLE hrms.onboarding_instance_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onboarding_inst_tasks ON hrms.onboarding_instance_tasks USING (tenant_id = current_tenant_id());
