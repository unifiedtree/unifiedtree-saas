-- =============================================================================
-- MODULE: hrms-recruitment
-- Tables: job_postings, candidates, job_applications, interviews, job_offers
-- Purpose: End-to-end hiring pipeline from job posting to offer acceptance.
--          Hired candidates link back to employees.id after onboarding.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: job_postings
-- A position open for hiring.
-- employment_mode: FULL_TIME | PART_TIME | CONTRACT | INTERNSHIP | FREELANCE
-- status: DRAFT | OPEN | ON_HOLD | CLOSED | CANCELLED
-- openings: total positions; filled: positions where offer was accepted.
-- -----------------------------------------------------------------------------
CREATE TABLE job_postings (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    company_id         UUID          NOT NULL,  -- → companies.id
    department_id      UUID,                    -- → departments.id
    title              VARCHAR(200)  NOT NULL,
    code               VARCHAR(50),             -- internal requisition code
    description        TEXT,
    requirements       TEXT,
    responsibilities   TEXT,
    employment_mode    VARCHAR(30),              -- FULL_TIME | PART_TIME | CONTRACT | INTERNSHIP | FREELANCE
    experience_min_years INT         DEFAULT 0,
    experience_max_years INT         DEFAULT 0,
    salary_min         NUMERIC(15,2),
    salary_max         NUMERIC(15,2),
    currency           VARCHAR(10)   DEFAULT 'INR',
    location           VARCHAR(200),
    is_remote          BOOLEAN       DEFAULT false,
    openings           INT           DEFAULT 1,
    filled             INT           DEFAULT 0,
    status             VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | OPEN | ON_HOLD | CLOSED | CANCELLED
    hiring_manager_id  UUID,                    -- → employees.id
    closing_date       DATE,
    posted_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_job_postings_company_status ON job_postings (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: candidates
-- External applicant profile.  Unique by (tenant, company, email).
-- ai_resume_score: 0–100 score from hrms-ai ResumeScoring service.
-- source: where the candidate came from (NAUKRI, LINKEDIN, REFERRAL, WALK_IN, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE candidates (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    company_id             UUID          NOT NULL,  -- → companies.id
    first_name             VARCHAR(100)  NOT NULL,
    last_name              VARCHAR(100)  NOT NULL,
    email                  VARCHAR(255)  NOT NULL,
    phone                  VARCHAR(20),
    resume_url             TEXT,                    -- object storage path
    linkedin_url           TEXT,
    current_company        VARCHAR(200),
    current_title          VARCHAR(200),
    experience_years       INT           DEFAULT 0,
    expected_salary        NUMERIC(15,2),
    notice_period_days     INT           DEFAULT 0,
    source                 VARCHAR(50),              -- NAUKRI | LINKEDIN | REFERRAL | WALK_IN | CAMPUS | OTHER
    referred_by_employee_id UUID,                   -- → employees.id (for referral bonus tracking)
    ai_resume_score        DOUBLE PRECISION,         -- 0–100 from AI scoring service
    skills                 TEXT,                    -- comma-separated or JSON array
    notes                  TEXT,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_candidate_company_email UNIQUE (tenant_id, company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_candidates_company ON candidates (company_id);

COMMENT ON COLUMN candidates.ai_resume_score IS '0–100 score from hrms-ai ResumeScoring. NULL if not yet scored.';

-- -----------------------------------------------------------------------------
-- TABLE: job_applications
-- A candidate applying to a specific job posting.
-- status / current_stage mirrors the pipeline stage:
--   APPLIED → SCREENING → SHORTLISTED → INTERVIEW → OFFER → HIRED | REJECTED | WITHDRAWN
-- hired_as_employee_id is set after onboarding converts candidate → employee.
-- -----------------------------------------------------------------------------
CREATE TABLE job_applications (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    job_posting_id       UUID          NOT NULL REFERENCES job_postings(id),
    candidate_id         UUID          NOT NULL REFERENCES candidates(id),
    status               VARCHAR(50)   NOT NULL DEFAULT 'APPLIED',  -- APPLIED | SCREENING | SHORTLISTED | INTERVIEW | OFFER | HIRED | REJECTED | WITHDRAWN
    cover_letter         TEXT,
    current_stage        VARCHAR(100),
    rejection_reason     TEXT,
    hired_as_employee_id UUID,                    -- → employees.id (set post-onboarding)
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_application_job_candidate UNIQUE (tenant_id, job_posting_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_job       ON job_applications (job_posting_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON job_applications (candidate_id);

-- -----------------------------------------------------------------------------
-- TABLE: interviews
-- One interview event per application per round.
-- interview_type: PHONE_SCREENING | TECHNICAL | MANAGERIAL | HR_ROUND | CASE_STUDY | PANEL
-- status: SCHEDULED | COMPLETED | CANCELLED | RESCHEDULED | NO_SHOW
-- interviewer_ids: JSON array of employee UUIDs (stored as TEXT to avoid cross-module FKs)
-- rating: 1–5 star rating by interviewer
-- -----------------------------------------------------------------------------
CREATE TABLE interviews (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    application_id   UUID          NOT NULL REFERENCES job_applications(id),
    candidate_id     UUID          NOT NULL,  -- → candidates.id (denormalised for query convenience)
    interview_type   VARCHAR(30),              -- PHONE_SCREENING | TECHNICAL | MANAGERIAL | HR_ROUND | CASE_STUDY | PANEL
    scheduled_at     TIMESTAMPTZ,
    duration_minutes INT           DEFAULT 60,
    interviewer_ids  TEXT,                    -- JSON array of employees.id UUIDs
    meeting_link     TEXT,                    -- video call URL
    location         VARCHAR(255),            -- physical room/address for in-person
    status           VARCHAR(30)   DEFAULT 'SCHEDULED',  -- SCHEDULED | COMPLETED | CANCELLED | RESCHEDULED | NO_SHOW
    feedback         TEXT,
    rating           INT,                     -- 1–5
    is_accepted      BOOLEAN,                 -- overall outcome: true=pass, false=fail, null=pending
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_interviews_application ON interviews (application_id);

COMMENT ON COLUMN interviews.interviewer_ids IS 'JSON array of employees.id UUIDs. Stored as TEXT to avoid cross-module FK.';

-- -----------------------------------------------------------------------------
-- TABLE: job_offers
-- Formal offer extended to a candidate after final interview clearance.
-- status: PENDING | APPROVED | REJECTED | ACCEPTED | EXPIRED
-- expires_at: offer validity date — auto-marked EXPIRED by a scheduled job.
-- -----------------------------------------------------------------------------
CREATE TABLE job_offers (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    application_id   UUID          NOT NULL REFERENCES job_applications(id),
    candidate_id     UUID          NOT NULL,  -- → candidates.id
    job_posting_id   UUID          NOT NULL,  -- → job_postings.id
    offered_salary   NUMERIC(15,2),
    currency         VARCHAR(10)   DEFAULT 'INR',
    joining_date     DATE,
    expires_at       DATE,                    -- offer acceptance deadline
    status           VARCHAR(30)   NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED | ACCEPTED | EXPIRED
    offer_letter_url TEXT,                    -- object storage path to signed PDF
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_offers_application ON job_offers (application_id);

COMMENT ON COLUMN job_offers.offer_letter_url IS 'Object storage path. Generate signed URL per request.';
