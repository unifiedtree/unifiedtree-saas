-- =============================================================================
-- MODULE: hrms-learning
-- Tables: courses, enrollments, course_certificates
-- Purpose: Internal learning & development platform.
--          HR creates courses, managers assign them, employees complete them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: courses
-- A learning course or training module.
-- status: DRAFT | PUBLISHED | ARCHIVED
-- is_mandatory: if true, eligible employees are auto-enrolled (by a scheduler).
-- target_role: optional — restricts mandatory auto-enroll to a specific role.
-- content_url: link to LMS content (S3 folder, external LMS URL, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE courses (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL,  -- → companies.id
    title                   VARCHAR(300)  NOT NULL,
    description             TEXT,
    category                VARCHAR(100),             -- e.g. TECHNICAL | COMPLIANCE | SOFT_SKILLS | ONBOARDING
    duration_hours          INT           DEFAULT 0,
    status                  VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED | ARCHIVED
    thumbnail_url           TEXT,
    content_url             TEXT,                    -- LMS URL or object storage path
    is_mandatory            BOOLEAN       DEFAULT false,
    target_role             VARCHAR(50),              -- restrict auto-enroll: EMPLOYEE | DEPT_MANAGER | etc.
    created_by_employee_id  UUID,                    -- → employees.id (course author)
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    version                 BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_courses_company ON courses (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: enrollments
-- Tracks an employee's progress through a course.
-- status: ENROLLED | IN_PROGRESS | COMPLETED | DROPPED
-- progress_percent: 0–100; set to 100 when status = COMPLETED.
-- due_date: completion deadline (set when course is mandatory or assigned by manager).
-- -----------------------------------------------------------------------------
CREATE TABLE enrollments (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    course_id        UUID          NOT NULL REFERENCES courses(id),
    employee_id      UUID          NOT NULL,  -- → employees.id
    status           VARCHAR(30)   NOT NULL DEFAULT 'ENROLLED',  -- ENROLLED | IN_PROGRESS | COMPLETED | DROPPED
    progress_percent INT           DEFAULT 0,  -- 0–100
    enrolled_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    due_date         DATE,                    -- NULL = no deadline
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_enrollment UNIQUE (tenant_id, course_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_employee ON enrollments (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_course   ON enrollments (course_id);

-- -----------------------------------------------------------------------------
-- TABLE: course_certificates
-- Issued when an enrollment reaches COMPLETED status.
-- certificate_number: human-readable unique identifier printed on the PDF.
-- expires_at: NULL for certificates without expiry.
-- certificate_url: object storage path to generated PDF certificate.
-- -----------------------------------------------------------------------------
CREATE TABLE course_certificates (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    enrollment_id      UUID          NOT NULL REFERENCES enrollments(id),
    employee_id        UUID          NOT NULL,  -- → employees.id (denormalised for fast lookups)
    course_id          UUID          NOT NULL,  -- → courses.id (denormalised)
    issued_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ,              -- NULL = never expires
    certificate_url    TEXT,                    -- object storage path
    certificate_number VARCHAR(50)   NOT NULL UNIQUE,  -- e.g. CERT-2025-000123
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_certificates_employee ON course_certificates (employee_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course   ON course_certificates (course_id);

COMMENT ON COLUMN course_certificates.certificate_number IS 'Human-readable number printed on PDF. Format: CERT-{YYYY}-{seq}.';
