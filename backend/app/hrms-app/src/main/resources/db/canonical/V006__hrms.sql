-- ============================================================================
-- V006 - hrms schema: departments, designations, employees, contractors
-- ============================================================================
-- Tenant-owned. RLS on. Fields chosen to cover the client's HR dashboard spec:
--   - Workforce Directory (filters by dept/branch/status)
--   - Organization Setup (departments + designations with parent/grade)
--   - Employee Vault (identity + bank fields)
--   - Onboarding (joining date, probation, confirmation)
--   - Exit workflow (resignation/LWD/exit reason)
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE hrms.employment_type AS ENUM ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hrms.employment_status AS ENUM ('PROBATION','ACTIVE','NOTICE_PERIOD','SUSPENDED','EXITED','TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hrms.gender AS ENUM ('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
CREATE TABLE hrms.departments (
    id                          UUID            PRIMARY KEY,
    tenant_id                   UUID            NOT NULL,
    company_id                  UUID            NOT NULL,
    name                        VARCHAR(100)    NOT NULL,
    code                        VARCHAR(30),
    parent_department_id        UUID            REFERENCES hrms.departments(id) ON DELETE SET NULL,
    department_head_employee_id UUID,
    description                 TEXT,
    employee_count_cached       INT             DEFAULT 0,
    is_active                   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_dept_tenant_name UNIQUE (tenant_id, company_id, name)
);

CREATE INDEX idx_departments_tenant ON hrms.departments(tenant_id);
CREATE INDEX idx_departments_company ON hrms.departments(tenant_id, company_id);
CREATE INDEX idx_departments_parent ON hrms.departments(tenant_id, parent_department_id);

ALTER TABLE hrms.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_departments ON hrms.departments
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Department-to-branch many-to-many (a department can span multiple branches)
CREATE TABLE hrms.department_branches (
    tenant_id       UUID    NOT NULL,
    department_id   UUID    NOT NULL REFERENCES hrms.departments(id) ON DELETE CASCADE,
    branch_id       UUID    NOT NULL,
    PRIMARY KEY (department_id, branch_id)
);

ALTER TABLE hrms.department_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_dept_branches ON hrms.department_branches
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE hrms.designations (
    id                          UUID            PRIMARY KEY,
    tenant_id                   UUID            NOT NULL,
    company_id                  UUID            NOT NULL,
    title                       VARCHAR(100)    NOT NULL,
    grade                       VARCHAR(10),                    -- L1..L6 in client spec
    department_id               UUID            REFERENCES hrms.departments(id) ON DELETE SET NULL,
    reports_to_designation_id   UUID            REFERENCES hrms.designations(id) ON DELETE SET NULL,
    job_responsibilities        TEXT,
    headcount_cached            INT             DEFAULT 0,
    is_active                   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_designation_tenant_title UNIQUE (tenant_id, company_id, title)
);

CREATE INDEX idx_designations_tenant ON hrms.designations(tenant_id);
CREATE INDEX idx_designations_dept ON hrms.designations(tenant_id, department_id);

ALTER TABLE hrms.designations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_designations ON hrms.designations
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE hrms.employees (
    id                          UUID                        PRIMARY KEY,
    tenant_id                   UUID                        NOT NULL,
    company_id                  UUID                        NOT NULL,
    -- identity / public
    employee_code               VARCHAR(50)                 NOT NULL,
    first_name                  VARCHAR(100)                NOT NULL,
    middle_name                 VARCHAR(100),
    last_name                   VARCHAR(100),
    preferred_name              VARCHAR(100),
    email                       VARCHAR(255),
    secondary_email             VARCHAR(255),
    phone                       VARCHAR(20),
    secondary_phone             VARCHAR(20),
    date_of_birth               DATE,
    gender                      hrms.gender,
    marital_status              VARCHAR(20),
    blood_group                 VARCHAR(5),
    nationality                 VARCHAR(50)                 DEFAULT 'Indian',
    profile_photo_url           VARCHAR(500),

    -- employment
    department_id               UUID                        REFERENCES hrms.departments(id),
    designation_id              UUID                        REFERENCES hrms.designations(id),
    branch_id                   UUID,
    reporting_manager_id        UUID                        REFERENCES hrms.employees(id),
    employment_type             hrms.employment_type        NOT NULL DEFAULT 'FULL_TIME',
    employment_status           hrms.employment_status      NOT NULL DEFAULT 'PROBATION',
    date_of_joining             DATE,
    probation_end_date          DATE,
    confirmation_date           DATE,
    notice_start_date           DATE,
    last_working_day            DATE,
    exit_reason                 VARCHAR(100),

    -- compensation snapshot (canonical lives in payroll module later)
    ctc_annual                  NUMERIC(14,2),
    job_responsibilities        TEXT,

    -- statutory identity
    pan_number                  VARCHAR(15),
    aadhaar_number              VARCHAR(20),
    passport_number             VARCHAR(20),
    pf_uan                      VARCHAR(20),
    esi_number                  VARCHAR(20),

    -- bank
    bank_name                   VARCHAR(100),
    bank_account_number         VARCHAR(50),
    bank_ifsc                   VARCHAR(15),
    bank_account_holder_name    VARCHAR(150),

    -- address
    current_address_line        VARCHAR(255),
    current_address_city        VARCHAR(100),
    current_address_state       VARCHAR(100),
    current_address_pincode     VARCHAR(15),
    permanent_address_line      VARCHAR(255),
    permanent_address_city      VARCHAR(100),
    permanent_address_state     VARCHAR(100),
    permanent_address_pincode   VARCHAR(15),

    -- emergency contact
    emergency_contact_name      VARCHAR(150),
    emergency_contact_relation  VARCHAR(50),
    emergency_contact_phone     VARCHAR(20),

    -- biometric (face recognition)
    is_face_enrolled            BOOLEAN                     NOT NULL DEFAULT FALSE,
    face_template_id            VARCHAR(100),
    face_enrolled_at            TIMESTAMPTZ,

    -- meta
    is_active                   BOOLEAN                     NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now(),

    CONSTRAINT uq_employee_tenant_code  UNIQUE (tenant_id, employee_code),
    CONSTRAINT uq_employee_tenant_email UNIQUE (tenant_id, email)
);

CREATE INDEX idx_employees_tenant         ON hrms.employees(tenant_id);
CREATE INDEX idx_employees_dept           ON hrms.employees(tenant_id, department_id);
CREATE INDEX idx_employees_branch         ON hrms.employees(tenant_id, branch_id);
CREATE INDEX idx_employees_manager        ON hrms.employees(tenant_id, reporting_manager_id);
CREATE INDEX idx_employees_status         ON hrms.employees(tenant_id, employment_status) WHERE is_active = TRUE;
CREATE INDEX idx_employees_name_search    ON hrms.employees USING gin (to_tsvector('simple', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(employee_code,'')));

ALTER TABLE hrms.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_employees ON hrms.employees
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Contractor master (separate from employees per client spec)
CREATE TABLE hrms.contractors (
    id                      UUID            PRIMARY KEY,
    tenant_id               UUID            NOT NULL,
    company_id              UUID            NOT NULL,
    agency_name             VARCHAR(150)    NOT NULL,
    registration_number     VARCHAR(50),
    gstin                   VARCHAR(20),
    contact_person_name     VARCHAR(100),
    contact_email           VARCHAR(255),
    contact_phone           VARCHAR(20),
    address_line            VARCHAR(255),
    city                    VARCHAR(100),
    state                   VARCHAR(100),
    active_workers_count    INT             DEFAULT 0,
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_contractor_tenant_name UNIQUE (tenant_id, company_id, agency_name)
);

CREATE INDEX idx_contractors_tenant ON hrms.contractors(tenant_id);

ALTER TABLE hrms.contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contractors ON hrms.contractors
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Classification rules (e.g. Factory Act categories - workman/staff/managerial)
CREATE TABLE hrms.classification_rules (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    company_id      UUID            NOT NULL,
    name            VARCHAR(100)    NOT NULL,
    code            VARCHAR(30),
    description     TEXT,
    headcount_cached INT            DEFAULT 0,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_classification_tenant ON hrms.classification_rules(tenant_id);

ALTER TABLE hrms.classification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_classification ON hrms.classification_rules
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- updated_at maintenance triggers (one helper, applied to each table)
CREATE OR REPLACE FUNCTION hrms.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_departments_updated_at  BEFORE UPDATE ON hrms.departments         FOR EACH ROW EXECUTE FUNCTION hrms.set_updated_at();
CREATE TRIGGER trg_designations_updated_at BEFORE UPDATE ON hrms.designations        FOR EACH ROW EXECUTE FUNCTION hrms.set_updated_at();
CREATE TRIGGER trg_employees_updated_at    BEFORE UPDATE ON hrms.employees           FOR EACH ROW EXECUTE FUNCTION hrms.set_updated_at();
CREATE TRIGGER trg_contractors_updated_at  BEFORE UPDATE ON hrms.contractors         FOR EACH ROW EXECUTE FUNCTION hrms.set_updated_at();
