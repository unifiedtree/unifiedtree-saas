-- =============================================================================
-- MODULE: hrms-employee
-- Tables: employees, emergency_contacts, employee_documents
-- Purpose: Core employee profile — the central entity referenced by almost
--          every other module. employee.id = the system-wide person identifier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: employees
-- Central person record.  All other modules store employee_id as a logical FK.
-- face_embedding: raw float32[] bytes from the face-recognition model;
--   isFaceEnrolled flags whether a valid embedding has been captured.
-- manager_id: self-referencing tree for org chart (nullable for CEO/roots).
--
-- gender:            MALE | FEMALE | OTHER | PREFER_NOT_TO_SAY
-- employment_type:   FULL_TIME | PART_TIME | CONTRACT | INTERN | CONSULTANT
-- employment_status: ACTIVE | ON_LEAVE | NOTICE_PERIOD | TERMINATED | RESIGNED
-- -----------------------------------------------------------------------------
CREATE TABLE employees (
    id                   UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id            UUID          NOT NULL,
    employee_code        VARCHAR(20)   NOT NULL,             -- e.g. EMP001, unique per tenant
    first_name           VARCHAR(100)  NOT NULL,
    last_name            VARCHAR(100)  NOT NULL,
    middle_name          VARCHAR(100),
    email                VARCHAR(255)  NOT NULL,             -- work email, unique per tenant
    personal_email       VARCHAR(255),
    phone                VARCHAR(20),
    date_of_birth        DATE,
    gender               VARCHAR(30),                        -- MALE | FEMALE | OTHER | PREFER_NOT_TO_SAY
    company_id           UUID          NOT NULL,             -- → companies.id
    department_id        UUID,                               -- → departments.id
    branch_id            UUID,                               -- → branches.id
    manager_id           UUID,                               -- → employees.id (self-ref)
    job_title            VARCHAR(150),
    employment_type      VARCHAR(30),                        -- FULL_TIME | PART_TIME | CONTRACT | INTERN | CONSULTANT
    employment_status    VARCHAR(30)   NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | ON_LEAVE | NOTICE_PERIOD | TERMINATED | RESIGNED
    date_of_joining      DATE,
    date_of_confirmation DATE,
    date_of_termination  DATE,
    probation_end_date   DATE,
    notice_period_days   INT           DEFAULT 30,
    work_location        VARCHAR(255),
    salary_frequency     VARCHAR(30),
    monthly_salary       NUMERIC(14,2),
    pan_number           VARCHAR(10),
    aadhaar_number       VARCHAR(12),
    uan_number           VARCHAR(20),
    esi_number           VARCHAR(30),
    bank_account_number  VARCHAR(30),
    bank_ifsc_code       VARCHAR(11),
    bank_name            VARCHAR(120),
    bank_branch_name     VARCHAR(150),
    profile_photo_url    TEXT,
    face_embedding       BYTEA,                              -- serialised float32[] from face-rec model
    is_face_enrolled     BOOLEAN       NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_employee_tenant_code  UNIQUE (tenant_id, employee_code),
    CONSTRAINT uq_employee_tenant_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_id         ON employees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_id        ON employees (company_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id     ON employees (department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager_id        ON employees (manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_employment_status ON employees (employment_status);

COMMENT ON COLUMN employees.face_embedding   IS 'Raw float32[] bytes from face-recognition model. Stored in BYTEA; deserialized by FaceEmbeddingService.';
COMMENT ON COLUMN employees.is_face_enrolled IS 'True only when a valid face_embedding has been captured and verified.';
COMMENT ON COLUMN employees.manager_id       IS 'Self-referencing FK for org hierarchy. NULL for company root/CEO.';

-- -----------------------------------------------------------------------------
-- TABLE: emergency_contacts
-- Multiple contacts per employee. is_primary flags the first-contact person.
-- Cascades delete when employee is hard-deleted (rare — prefer TERMINATED status).
-- -----------------------------------------------------------------------------
CREATE TABLE emergency_contacts (
    id           UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID          NOT NULL,
    employee_id  UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name         VARCHAR(150)  NOT NULL,
    relationship VARCHAR(50),                                -- e.g. Spouse, Parent, Sibling
    phone        VARCHAR(20),
    email        VARCHAR(255),
    is_primary   BOOLEAN       DEFAULT false,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_employee_id ON emergency_contacts (employee_id);

-- -----------------------------------------------------------------------------
-- TABLE: employee_documents
-- Uploaded documents (ID proofs, certificates, offer letters, etc.).
-- document_type: AADHAAR | PAN | PASSPORT | DRIVING_LICENSE | DEGREE |
--                EXPERIENCE_LETTER | OFFER_LETTER | OTHER
-- file_url: S3/GCS signed-URL path (never a public URL).
-- -----------------------------------------------------------------------------
CREATE TABLE employee_documents (
    id            UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     UUID          NOT NULL,
    employee_id   UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type VARCHAR(50)   NOT NULL,   -- AADHAAR | PAN | PASSPORT | DRIVING_LICENSE | DEGREE | EXPERIENCE_LETTER | OFFER_LETTER | OTHER
    document_name VARCHAR(255),
    file_url      TEXT,                     -- S3/GCS object path
    file_size     BIGINT,                   -- bytes
    is_verified   BOOLEAN       DEFAULT false,
    expires_at    DATE,                     -- for passports, visas, etc.
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id   ON employee_documents (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_document_type ON employee_documents (document_type);

COMMENT ON COLUMN employee_documents.file_url   IS 'Object storage path. Generate signed URLs per-request; never expose raw path to clients.';
COMMENT ON COLUMN employee_documents.expires_at IS 'Relevant for documents with validity periods (passport, visa, certification).';
