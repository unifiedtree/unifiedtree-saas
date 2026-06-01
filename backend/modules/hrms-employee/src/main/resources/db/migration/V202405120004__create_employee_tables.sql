-- ============================================================
-- Migration: V202405120004__create_employee_tables.sql
-- Creates: employees, emergency_contacts, employee_documents
-- ============================================================

CREATE TABLE employees
(
    id                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id            UUID         NOT NULL,
    employee_code        VARCHAR(20)  NOT NULL,
    first_name           VARCHAR(100) NOT NULL,
    last_name            VARCHAR(100) NOT NULL,
    middle_name          VARCHAR(100),
    email                VARCHAR(255) NOT NULL,
    personal_email       VARCHAR(255),
    phone                VARCHAR(20),
    date_of_birth        DATE,
    gender               VARCHAR(30),
    company_id           UUID         NOT NULL,
    department_id        UUID,
    branch_id            UUID,
    manager_id           UUID,
    job_title            VARCHAR(150),
    employment_type      VARCHAR(30),
    employment_status    VARCHAR(30)  NOT NULL DEFAULT 'ACTIVE',
    date_of_joining      DATE,
    date_of_confirmation DATE,
    date_of_termination  DATE,
    probation_end_date   DATE,
    notice_period_days   INT                   DEFAULT 30,
    work_location        VARCHAR(255),
    profile_photo_url    TEXT,
    face_embedding       BYTEA,
    is_face_enrolled     BOOLEAN      NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_employee_tenant_code UNIQUE (tenant_id, employee_code),
    CONSTRAINT uq_employee_tenant_email UNIQUE (tenant_id, email)
);

CREATE INDEX idx_employees_tenant_id
    ON employees (tenant_id);

CREATE INDEX idx_employees_company_id
    ON employees (company_id);

CREATE INDEX idx_employees_department_id
    ON employees (department_id);

CREATE INDEX idx_employees_manager_id
    ON employees (manager_id);

CREATE INDEX idx_employees_employment_status
    ON employees (employment_status);

-- ----------------------------------------------------------------

CREATE TABLE emergency_contacts
(
    id           UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID         NOT NULL,
    employee_id  UUID         NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    name         VARCHAR(150) NOT NULL,
    relationship VARCHAR(50),
    phone        VARCHAR(20),
    email        VARCHAR(255),
    is_primary   BOOLEAN               DEFAULT false,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT       NOT NULL DEFAULT 0
);

CREATE INDEX idx_emergency_contacts_tenant_id
    ON emergency_contacts (tenant_id);

CREATE INDEX idx_emergency_contacts_employee_id
    ON emergency_contacts (employee_id);

-- ----------------------------------------------------------------

CREATE TABLE employee_documents
(
    id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     UUID        NOT NULL,
    employee_id   UUID        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_name VARCHAR(255),
    file_url      TEXT,
    file_size     BIGINT,
    is_verified   BOOLEAN              DEFAULT false,
    expires_at    DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT      NOT NULL DEFAULT 0
);

CREATE INDEX idx_employee_documents_tenant_id
    ON employee_documents (tenant_id);

CREATE INDEX idx_employee_documents_employee_id
    ON employee_documents (employee_id);

CREATE INDEX idx_employee_documents_document_type
    ON employee_documents (document_type);
