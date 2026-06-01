-- ============================================================
-- 01_core.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- =============================================================================
-- MODULE: hrms-core
-- Tables: audit_log
-- Purpose: Tamper-evident immutable audit trail shared across all modules.
--          Every state-changing operation in the platform writes a row here.
-- =============================================================================

-- Checksum = SHA-256( tenant_id | actor_id | action | resource_type | resource_id | occurred_at )
-- Never UPDATE or DELETE rows. Retention enforced by partition pruning after 7 years.

CREATE TABLE IF NOT EXISTS audit_log (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    actor_id      VARCHAR(255)  NOT NULL,                 -- user_credentials.id (as string)
    actor_role    VARCHAR(50)   NOT NULL,                 -- role at time of action
    action        VARCHAR(100)  NOT NULL,                 -- e.g. CREATE, UPDATE, DELETE, LOGIN
    resource_type VARCHAR(100)  NOT NULL,                 -- e.g. Employee, LeaveRequest
    resource_id   VARCHAR(255),                           -- UUID of affected record
    old_value     JSONB,                                  -- snapshot before change
    new_value     JSONB,                                  -- snapshot after change
    ip_address    INET,
    user_agent    TEXT,
    occurred_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    checksum      VARCHAR(64)   NOT NULL                  -- SHA-256 hex for tamper detection
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id   ON audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id    ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource    ON audit_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log (occurred_at DESC);

COMMENT ON TABLE  audit_log              IS 'Tamper-evident audit trail. Never mutate rows.';
COMMENT ON COLUMN audit_log.checksum     IS 'SHA-256 of (tenant_id|actor_id|action|resource_type|resource_id|occurred_at)';
COMMENT ON COLUMN audit_log.old_value    IS 'Full entity snapshot before the change (nullable for CREATE)';
COMMENT ON COLUMN audit_log.new_value    IS 'Full entity snapshot after the change (nullable for DELETE)';


-- ============================================================
-- 02_auth.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-auth
-- Tables: user_credentials, user_roles, refresh_tokens
-- Purpose: Authentication credentials and session management.
--          Identity is separate from employee profile (hrms-employee).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: user_credentials
-- One row per login identity. Linked to an employee via employee_id after onboarding.
-- Unique per (tenant_id, email) â€” the same email can exist in different tenants.
-- -----------------------------------------------------------------------------
CREATE TABLE user_credentials (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    email                 VARCHAR(255)  NOT NULL,
    mobile_number         VARCHAR(20),
    password_hash         VARCHAR(255)  NOT NULL,           -- BCrypt cost-10
    employee_id           UUID,                             -- â†’ employees.id (set after onboarding)
    is_active             BOOLEAN       NOT NULL DEFAULT true,
    is_mfa_enabled        BOOLEAN       NOT NULL DEFAULT false,
    is_biometric_enabled  BOOLEAN       NOT NULL DEFAULT false,
    mfa_secret            VARCHAR(255),                     -- TOTP base32 secret (encrypted at rest)
    failed_login_attempts INT           NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,                      -- NULL = not locked
    last_login_at         TIMESTAMPTZ,
    password_changed_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_user_credentials_tenant_email UNIQUE (tenant_id, email)
);

COMMENT ON COLUMN user_credentials.employee_id        IS 'Set after employee onboarding; NULL for super-admin accounts.';
COMMENT ON COLUMN user_credentials.mfa_secret         IS 'TOTP base32 secret. Must be encrypted at rest in prod.';
COMMENT ON COLUMN user_credentials.failed_login_attempts IS 'Reset to 0 on successful login. Account locks at 5.';

-- -----------------------------------------------------------------------------
-- TABLE: user_roles
-- Many roles per user_credential (e.g., HR_MANAGER + EMPLOYEE simultaneously).
-- Roles: SUPER_ADMIN | COMPANY_ADMIN | HR_MANAGER | DEPT_MANAGER | EMPLOYEE
-- -----------------------------------------------------------------------------
CREATE TABLE user_roles (
    user_credential_id UUID        NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
    role               VARCHAR(50) NOT NULL,
    PRIMARY KEY (user_credential_id, role)
);

COMMENT ON TABLE user_roles IS 'Valid roles: SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, DEPT_MANAGER, EMPLOYEE';

-- -----------------------------------------------------------------------------
-- TABLE: refresh_tokens
-- JWT refresh token store. token_hash = SHA-256 of the raw token string.
-- Revoke by setting revoked=true; expired tokens are purged by a scheduled job.
-- -----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    user_credential_id UUID          NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
    token_hash         VARCHAR(512)  NOT NULL UNIQUE,        -- SHA-256 of raw token
    expires_at         TIMESTAMPTZ   NOT NULL,
    revoked            BOOLEAN       NOT NULL DEFAULT false,
    device_fingerprint VARCHAR(255),                         -- optional device tracking
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);

COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 of the raw refresh token string. Never store raw token.';

CREATE INDEX IF NOT EXISTS idx_user_credentials_tenant_email ON user_credentials (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_user_credentials_employee_id  ON user_credentials (employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credentials_tenant_mobile
    ON user_credentials (tenant_id, mobile_number)
    WHERE mobile_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash     ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id        ON refresh_tokens (user_credential_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at     ON refresh_tokens (expires_at) WHERE revoked = false;

CREATE TABLE auth_otp_challenges (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    mobile_number      VARCHAR(20)   NOT NULL,
    code_hash          VARCHAR(512)  NOT NULL,
    purpose            VARCHAR(50)   NOT NULL DEFAULT 'LOGIN',
    attempts           INT           NOT NULL DEFAULT 0,
    max_attempts       INT           NOT NULL DEFAULT 3,
    expires_at         TIMESTAMPTZ   NOT NULL,
    consumed_at        TIMESTAMPTZ,
    device_fingerprint VARCHAR(255),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_otp_mobile_created
    ON auth_otp_challenges (tenant_id, mobile_number, created_at DESC);


-- ============================================================
-- 03_tenant.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-tenant
-- Tables: companies, departments, branches
-- Purpose: Multi-tenant organisation hierarchy.
--          tenant_id = top-level isolation key (one per SaaS customer).
--          company_id = the specific legal entity within a tenant.
--          A tenant may own multiple companies (e.g., group companies).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: companies
-- Root entity for a tenant's organisation. All other domain records reference
-- company_id for per-company data isolation.
--
-- subscription_tier: STARTER | GROWTH | ENTERPRISE
-- settings: arbitrary JSONB config (leave policies override, branding, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    name              VARCHAR(255)  NOT NULL,
    domain            VARCHAR(255),                          -- unique per tenant
    logo_url          VARCHAR(512),
    subscription_tier VARCHAR(50),                           -- STARTER | GROWTH | ENTERPRISE
    max_employees     INT           NOT NULL DEFAULT 0,      -- 0 = unlimited
    industry          VARCHAR(255),
    country           VARCHAR(100),
    timezone          VARCHAR(100),                          -- IANA tz, e.g. Asia/Kolkata
    currency          VARCHAR(10)   NOT NULL DEFAULT 'INR',
    is_active         BOOLEAN       NOT NULL DEFAULT true,
    settings          JSONB,                                 -- free-form config blob
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_companies PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_tenant_domain
    ON companies (tenant_id, domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_tenant_id ON companies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_is_active ON companies (tenant_id, is_active);

COMMENT ON COLUMN companies.settings IS 'Arbitrary JSONB config: branding, policy overrides, feature flags.';
COMMENT ON COLUMN companies.max_employees IS '0 means unlimited (Enterprise tier).';

-- -----------------------------------------------------------------------------
-- TABLE: departments
-- Supports unlimited-depth hierarchy via parent_department_id self-reference.
-- head_employee_id is a logical FK to employees.id (not enforced in DB).
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
    id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    company_id           UUID          NOT NULL REFERENCES companies(id),
    name                 VARCHAR(255)  NOT NULL,
    code                 VARCHAR(100),
    parent_department_id UUID          REFERENCES departments(id),  -- NULL = root dept
    head_employee_id     UUID,                                       -- â†’ employees.id (logical FK)
    is_active            BOOLEAN       NOT NULL DEFAULT true,
    description          TEXT,
    color_hex            VARCHAR(20),
    icon_key             VARCHAR(50),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_departments PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant_id   ON departments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_company_id  ON departments (company_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent_id   ON departments (parent_department_id);

COMMENT ON COLUMN departments.parent_department_id IS 'NULL for root departments. Supports unlimited tree depth.';
COMMENT ON COLUMN departments.head_employee_id     IS 'Logical FK to employees.id; not enforced to avoid cross-module constraint.';

-- -----------------------------------------------------------------------------
-- TABLE: branches
-- Physical office locations. geo_fence_radius_meters + latitude/longitude used
-- for geo-attendance check-in validation in hrms-attendance.
-- geo_fence_polygon: WKT or GeoJSON string for complex non-circular zones.
-- -----------------------------------------------------------------------------
CREATE TABLE branches (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL REFERENCES companies(id),
    name                    VARCHAR(255)  NOT NULL,
    code                    VARCHAR(100),
    address                 TEXT,
    city                    VARCHAR(100),
    state                   VARCHAR(100),
    country                 VARCHAR(100),
    pincode                 VARCHAR(20),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    geo_fence_radius_meters INT           NOT NULL DEFAULT 100,  -- metres from lat/lng centre
    geo_fence_polygon       TEXT,                                -- WKT/GeoJSON for irregular zones
    color_hex               VARCHAR(20),
    icon_key                VARCHAR(50),
    is_headquarters         BOOLEAN       NOT NULL DEFAULT false,
    is_active               BOOLEAN       NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    version                 BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_branches PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id  ON branches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches (company_id);

COMMENT ON COLUMN branches.geo_fence_radius_meters IS 'Circular geofence radius. Overridden by geo_fence_polygon when set.';
COMMENT ON COLUMN branches.geo_fence_polygon       IS 'WKT POLYGON or GeoJSON string for non-circular geofence boundaries.';


-- ============================================================
-- 04_employee.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-employee
-- Tables: employees, emergency_contacts, employee_documents
-- Purpose: Core employee profile â€” the central entity referenced by almost
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
    company_id           UUID          NOT NULL,             -- â†’ companies.id
    department_id        UUID,                               -- â†’ departments.id
    branch_id            UUID,                               -- â†’ branches.id
    manager_id           UUID,                               -- â†’ employees.id (self-ref)
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
-- Cascades delete when employee is hard-deleted (rare â€” prefer TERMINATED status).
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


-- ============================================================
-- 05_attendance.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-attendance
-- Tables: attendance_records, attendance_event_logs, attendance_correction_requests,
--         geo_fence_zones, shift_policies, geo_fence_audits
-- Purpose: Daily attendance tracking with face-recognition, geo-fencing,
--          manager corrections, mobile dashboards, and sync-safe punch events.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: attendance_records
-- Immutable record of a single work-day for one employee.
-- check_in_method/check_out_method: FACE | GEO | MANUAL | BIOMETRIC | QR
-- attendance_type: PRESENT | ABSENT | HALF_DAY | WFH | ON_DUTY | HOLIDAY | WEEKLY_OFF
-- attendance_status: CHECKED_IN | CHECKED_OUT | MISSED_CHECKOUT | REGULARIZED | REJECTED
-- is_regularized: HR/manager overrode the original status.
-- working_hours: computed decimal hours, e.g. 8.5.
-- face_confidence_score: 0.0-1.0 from face-recognition model.
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_records (
    id                     UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID             NOT NULL,
    employee_id            UUID             NOT NULL,   -- employees.id
    company_id             UUID             NOT NULL,   -- companies.id
    department_id          UUID,                        -- departments.id snapshot
    branch_id              UUID,                        -- branches.id
    attendance_date        DATE             NOT NULL,
    check_in_at            TIMESTAMPTZ,
    check_out_at           TIMESTAMPTZ,
    attendance_type        VARCHAR(30),                 -- PRESENT | ABSENT | HALF_DAY | WFH | ON_DUTY | HOLIDAY | WEEKLY_OFF
    attendance_status      VARCHAR(30),                 -- CHECKED_IN | CHECKED_OUT | MISSED_CHECKOUT | REGULARIZED | REJECTED
    check_in_method        VARCHAR(30),                 -- FACE | GEO | MANUAL | BIOMETRIC | QR
    check_out_method       VARCHAR(30),                 -- FACE | GEO | MANUAL | BIOMETRIC | QR
    check_in_latitude      DOUBLE PRECISION,
    check_in_longitude     DOUBLE PRECISION,
    check_out_latitude     DOUBLE PRECISION,
    check_out_longitude    DOUBLE PRECISION,
    check_in_zone_id       UUID,
    check_out_zone_id      UUID,
    location_name          VARCHAR(255),
    check_in_zone_name     VARCHAR(255),
    check_out_zone_name    VARCHAR(255),
    face_confidence_score  DOUBLE PRECISION,            -- 0.0-1.0; null if not FACE method
    late_by_minutes        INT,
    overtime_minutes       INT,
    is_manual_entry        BOOLEAN          NOT NULL DEFAULT false,
    managed_by_employee_id UUID,
    manager_note           TEXT,
    client_event_id        VARCHAR(120),
    device_id              VARCHAR(120),
    is_regularized         BOOLEAN          NOT NULL DEFAULT false,
    regularization_reason  TEXT,
    working_hours          DOUBLE PRECISION,
    remarks                TEXT,
    created_at             TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT           NOT NULL DEFAULT 0,
    CONSTRAINT uq_attendance_employee_date UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records (employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_dept_date     ON attendance_records (department_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_company_date  ON attendance_records (company_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant        ON attendance_records (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_client_event
    ON attendance_records (tenant_id, client_event_id)
    WHERE client_event_id IS NOT NULL;

COMMENT ON COLUMN attendance_records.department_id         IS 'Snapshotted at check-in time. Preserved even if employee transfers department later.';
COMMENT ON COLUMN attendance_records.face_confidence_score IS '0.0-1.0 from face-rec model. Threshold for acceptance configured in company settings.';
COMMENT ON COLUMN attendance_records.is_regularized        IS 'True when HR/manager overrode the system-recorded status post-facto.';

-- -----------------------------------------------------------------------------
-- TABLE: attendance_event_logs
-- Chronological activity stream for manager/admin dashboards and mobile sync.
-- event_type: CHECK_IN | CHECK_OUT | MANUAL_ENTRY | CORRECTION_REQUESTED |
--             CORRECTION_APPROVED | CORRECTION_REJECTED | MISSED_CHECKOUT
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_event_logs (
    id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID             NOT NULL,
    attendance_record_id UUID,
    employee_id          UUID             NOT NULL,
    company_id           UUID             NOT NULL,
    department_id        UUID,
    branch_id            UUID,
    event_date           DATE             NOT NULL,
    event_at             TIMESTAMPTZ      NOT NULL,
    event_type           VARCHAR(50)      NOT NULL,
    attendance_status    VARCHAR(30),
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    location_name        VARCHAR(255),
    zone_name            VARCHAR(255),
    actor_employee_id    UUID,
    note                 TEXT,
    created_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_employee_date
    ON attendance_event_logs (employee_id, event_date, event_at);
CREATE INDEX IF NOT EXISTS idx_attendance_events_company_date
    ON attendance_event_logs (company_id, event_date, event_at);

-- -----------------------------------------------------------------------------
-- TABLE: attendance_correction_requests
-- Employee-submitted attendance correction workflow for manager/admin approval.
-- status: PENDING | APPROVED | REJECTED
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_correction_requests (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    employee_id            UUID          NOT NULL,
    company_id             UUID          NOT NULL,
    department_id          UUID,
    attendance_record_id   UUID,
    requested_date         DATE          NOT NULL,
    requested_check_in_at  TIMESTAMPTZ,
    requested_check_out_at TIMESTAMPTZ,
    reason                 TEXT          NOT NULL,
    attachment_url         TEXT,
    status                 VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
    approver_id            UUID,
    approver_comment       TEXT,
    decided_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_employee
    ON attendance_correction_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_company
    ON attendance_correction_requests (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: geo_fence_zones
-- Named punch zones for branches/departments, used by mobile maps and validation.
-- -----------------------------------------------------------------------------
CREATE TABLE geo_fence_zones (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL,
    company_id      UUID             NOT NULL,
    branch_id       UUID,
    department_id   UUID,
    name            VARCHAR(150)     NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    radius_meters   INT              NOT NULL DEFAULT 100,
    punch_method    VARCHAR(30)      NOT NULL DEFAULT 'FACE_RECOGNITION',
    color_hex       VARCHAR(20),
    icon_key        VARCHAR(50),
    is_active       BOOLEAN          NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geo_fence_zones_company
    ON geo_fence_zones (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: shift_policies
-- Defines working hours for a company.
-- shift_type: FIXED | FLEXIBLE | ROTATIONAL | NIGHT
-- -----------------------------------------------------------------------------
CREATE TABLE shift_policies (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    company_id            UUID          NOT NULL,  -- companies.id
    name                  VARCHAR(100)  NOT NULL,
    shift_type            VARCHAR(30),             -- FIXED | FLEXIBLE | ROTATIONAL | NIGHT
    start_time            TIME,                    -- e.g. 09:00
    end_time              TIME,                    -- e.g. 18:00
    grace_period_minutes  INT           DEFAULT 15,
    working_hours_per_day DOUBLE PRECISION DEFAULT 8.0,
    is_active             BOOLEAN       NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shift_policies_company ON shift_policies (company_id);

-- -----------------------------------------------------------------------------
-- TABLE: geo_fence_audits
-- Logs every geo-fence evaluation event, whether the check-in location was
-- inside or outside the branch boundary.
-- action_taken: CHECKIN_ALLOWED | WFH_PROMPTED | DENIED
-- -----------------------------------------------------------------------------
CREATE TABLE geo_fence_audits (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL,
    employee_id     UUID             NOT NULL,  -- employees.id
    branch_id       UUID,                        -- branches.id
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    within_fence    BOOLEAN          NOT NULL,
    distance_meters DOUBLE PRECISION,
    action_taken    VARCHAR(50),                 -- CHECKIN_ALLOWED | WFH_PROMPTED | DENIED
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geo_fence_audits_employee ON geo_fence_audits (employee_id);
CREATE INDEX IF NOT EXISTS idx_geo_fence_audits_branch   ON geo_fence_audits (branch_id);


-- ============================================================
-- 06_leave.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-leave
-- Tables: leave_types, leave_balances, leave_requests, holiday_calendars
-- Purpose: Leave policy definition, balance tracking, and approval workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: leave_types
-- Defines the leave policies available in a company.
-- category: EARNED | SICK | CASUAL | MATERNITY | PATERNITY | BEREAVEMENT | SABBATICAL | OTHER
-- applicable_gender: NULL = all genders; 'FEMALE' = maternity-only types, etc.
-- -----------------------------------------------------------------------------
CREATE TABLE leave_types (
    id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL,
    company_id               UUID          NOT NULL,  -- â†’ companies.id
    name                     VARCHAR(100)  NOT NULL,
    code                     VARCHAR(30)   NOT NULL,  -- e.g. ANNUAL, SICK, CASUAL â€” unique per company
    category                 VARCHAR(50),              -- EARNED | SICK | CASUAL | MATERNITY | PATERNITY | BEREAVEMENT | SABBATICAL | OTHER
    annual_entitlement       DOUBLE PRECISION NOT NULL,
    max_consecutive_days     INT           DEFAULT 0,  -- 0 = no limit
    min_notice_days          INT           DEFAULT 0,  -- minimum advance notice required
    is_carry_forward_allowed BOOLEAN       DEFAULT false,
    max_carry_forward_days   INT           DEFAULT 0,
    is_encashable            BOOLEAN       DEFAULT false,
    is_paid_leave            BOOLEAN       DEFAULT true,
    is_active                BOOLEAN       DEFAULT true,
    applicable_gender        VARCHAR(20),              -- NULL = all; FEMALE | MALE | OTHER
    description              TEXT,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by               VARCHAR(255),
    updated_by               VARCHAR(255),
    version                  BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_type_company_code UNIQUE (tenant_id, company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_company ON leave_types (company_id);

COMMENT ON COLUMN leave_types.applicable_gender IS 'NULL = applies to all genders. Set FEMALE for maternity, MALE for paternity.';
COMMENT ON COLUMN leave_types.code              IS 'Short identifier used in payroll and reports (e.g. ANNUAL, SICK, CASUAL).';

-- -----------------------------------------------------------------------------
-- TABLE: leave_balances
-- Current leave balance per employee per leave_type per year.
-- available = total_entitlement + carry_forward - used - pending  (computed in app)
-- One row per (tenant_id, employee_id, leave_type_id, year).
-- -----------------------------------------------------------------------------
CREATE TABLE leave_balances (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    employee_id       UUID          NOT NULL,  -- â†’ employees.id
    leave_type_id     UUID          NOT NULL REFERENCES leave_types(id),
    year              INT           NOT NULL,
    total_entitlement DOUBLE PRECISION NOT NULL DEFAULT 0,
    used              DOUBLE PRECISION NOT NULL DEFAULT 0,
    pending           DOUBLE PRECISION NOT NULL DEFAULT 0,  -- sum of PENDING requests
    carry_forward     DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_leave_balance UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances (employee_id, year);

COMMENT ON COLUMN leave_balances.pending IS 'Days blocked by open PENDING requests. Freed when request is REJECTED or CANCELLED.';

-- -----------------------------------------------------------------------------
-- TABLE: leave_requests
-- A single leave application.
-- duration: FULL_DAY | FIRST_HALF | SECOND_HALF
-- status:   PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN
-- total_days: business days (excluding holidays/weekends) â€” computed by the app.
-- -----------------------------------------------------------------------------
CREATE TABLE leave_requests (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    employee_id         UUID          NOT NULL,  -- â†’ employees.id (applicant)
    leave_type_id       UUID          NOT NULL REFERENCES leave_types(id),
    approver_id         UUID,                    -- â†’ employees.id (manager who approves)
    start_date          DATE          NOT NULL,
    end_date            DATE          NOT NULL,
    duration            VARCHAR(30),             -- FULL_DAY | FIRST_HALF | SECOND_HALF
    total_days          DOUBLE PRECISION NOT NULL,
    reason              TEXT,
    status              VARCHAR(30)   NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN
    approver_comment    TEXT,
    approved_at         TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by          VARCHAR(255),
    updated_by          VARCHAR(255),
    version             BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_approver ON leave_requests (approver_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: holiday_calendars
-- Public and optional holidays for a company in a given year.
-- is_optional: true = employee may choose to take it; false = mandatory public holiday.
-- -----------------------------------------------------------------------------
CREATE TABLE holiday_calendars (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    company_id   UUID          NOT NULL,  -- â†’ companies.id
    name         VARCHAR(150)  NOT NULL,  -- e.g. 'Republic Day', 'Diwali'
    holiday_date DATE          NOT NULL,
    year         INT           NOT NULL,
    is_optional  BOOLEAN       DEFAULT false,
    description  TEXT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_holidays_company_year ON holiday_calendars (company_id, year);


-- ============================================================
-- 07_payroll.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-payroll
-- Tables: employee_salary_structures, payroll_runs, payslips,
--         payslip_components, tax_slabs
-- Purpose: Salary configuration, monthly payroll processing, payslip generation,
--          and Indian tax slab management (TDS / Income Tax).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: employee_salary_structures
-- Defines the CTC breakdown for an employee.  Effective date ranges allow
-- salary revisions without losing history.
-- Only one row per employee should have is_active=true (enforced by the app).
-- basic = ctc_annual * (basic_percent / 100) / 12
-- hra   = ctc_annual * (hra_percent / 100) / 12
-- special_allowance = monthly_gross - basic - hra - other_components
-- -----------------------------------------------------------------------------
CREATE TABLE employee_salary_structures (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID             NOT NULL,
    employee_id   UUID             NOT NULL,  -- â†’ employees.id
    company_id    UUID             NOT NULL,  -- â†’ companies.id
    effective_from DATE            NOT NULL,
    effective_to   DATE,                      -- NULL = currently active
    ctc_annual     NUMERIC(15,2)   NOT NULL,
    basic_percent  DOUBLE PRECISION DEFAULT 40.0,
    hra_percent    DOUBLE PRECISION DEFAULT 20.0,
    is_active      BOOLEAN         NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_salary_structure_employee ON employee_salary_structures (employee_id, is_active);

COMMENT ON COLUMN employee_salary_structures.ctc_annual   IS 'Annual Cost-to-Company in INR (or company currency).';
COMMENT ON COLUMN employee_salary_structures.basic_percent IS 'Percentage of ctc_annual. Default 40%. Basic is PF-eligible.';
COMMENT ON COLUMN employee_salary_structures.is_active    IS 'Only one active structure per employee at a time.';

-- -----------------------------------------------------------------------------
-- TABLE: payroll_runs
-- One run per company per (month, year).  Triggered by HR, processed by Spring Batch.
-- status: DRAFT | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
-- batch_job_execution_id: Spring Batch JobExecution.id for traceability.
-- -----------------------------------------------------------------------------
CREATE TABLE payroll_runs (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    company_id            UUID          NOT NULL,  -- â†’ companies.id
    month                 INT           NOT NULL,  -- 1â€“12
    year                  INT           NOT NULL,
    status                VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
    total_employees       INT           DEFAULT 0,
    processed_count       INT           DEFAULT 0,
    total_gross_pay       NUMERIC(15,2),
    total_net_pay         NUMERIC(15,2),
    total_deductions      NUMERIC(15,2),
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    initiated_by          VARCHAR(255),             -- email of HR who triggered the run
    batch_job_execution_id BIGINT,                  -- Spring Batch job reference
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_payroll_run_company_month_year UNIQUE (tenant_id, company_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON payroll_runs (company_id, year, month);

-- -----------------------------------------------------------------------------
-- TABLE: payslips
-- One payslip per employee per (month, year), linked to a payroll_run.
-- lop_days: Loss-of-Pay days (absent without approved leave).
-- status: GENERATED (internal) | PUBLISHED (visible to employee)
-- -----------------------------------------------------------------------------
CREATE TABLE payslips (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    payroll_run_id   UUID          NOT NULL REFERENCES payroll_runs(id),
    employee_id      UUID          NOT NULL,  -- â†’ employees.id
    company_id       UUID          NOT NULL,  -- â†’ companies.id
    month            INT           NOT NULL,
    year             INT           NOT NULL,
    gross_pay        NUMERIC(15,2) NOT NULL,
    total_deductions NUMERIC(15,2) NOT NULL,
    net_pay          NUMERIC(15,2) NOT NULL,  -- gross_pay - total_deductions
    working_days     INT,                      -- total working days in the month
    present_days     INT,                      -- days employee was present
    lop_days         INT,                      -- Loss-of-Pay days (absent without leave)
    pf_contribution  NUMERIC(10,2),            -- Employee PF (12% of basic, max â‚¹1800/mo)
    esi_contribution NUMERIC(10,2),            -- Employee ESI (0.75% of gross, if applicable)
    tds_deducted     NUMERIC(10,2),            -- Monthly TDS advance
    status           VARCHAR(30)   NOT NULL DEFAULT 'GENERATED',  -- GENERATED | PUBLISHED
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_payslip_employee_month_year UNIQUE (tenant_id, employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips (employee_id, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_run      ON payslips (payroll_run_id);

COMMENT ON COLUMN payslips.lop_days        IS 'Loss-of-Pay days deducted proportionally from gross pay.';
COMMENT ON COLUMN payslips.pf_contribution IS 'Employee PF share: 12% of basic salary, capped at â‚¹1800/month.';
COMMENT ON COLUMN payslips.tds_deducted    IS 'Monthly advance TDS computed from projected annual income and tax_slabs.';

-- -----------------------------------------------------------------------------
-- TABLE: payslip_components
-- Line-item earnings and deductions on a payslip.
-- component_type: BASIC | HRA | SPECIAL_ALLOWANCE | LTA | MEDICAL | PF | ESI |
--                 TDS | PROFESSIONAL_TAX | LOP | BONUS | OTHER_EARNING | OTHER_DEDUCTION
-- is_earning: true = earning row, false = deduction row
-- -----------------------------------------------------------------------------
CREATE TABLE payslip_components (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    payslip_id     UUID          NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    component_type VARCHAR(50)   NOT NULL,  -- BASIC | HRA | SPECIAL_ALLOWANCE | LTA | MEDICAL | PF | ESI | TDS | PROFESSIONAL_TAX | LOP | BONUS | OTHER_EARNING | OTHER_DEDUCTION
    component_name VARCHAR(100)  NOT NULL,  -- display name on PDF payslip
    amount         NUMERIC(15,2) NOT NULL,
    is_earning     BOOLEAN       NOT NULL DEFAULT true,  -- false = deduction
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payslip_components_payslip ON payslip_components (payslip_id);

-- -----------------------------------------------------------------------------
-- TABLE: tax_slabs
-- Indian Income Tax slabs per financial year and regime (OLD / NEW).
-- max_income NULL = no upper limit (top slab).
-- The payroll engine finds applicable slabs for an employee's projected annual
-- income and computes TDS based on applicable tax_rate_percent + surcharge_percent.
-- -----------------------------------------------------------------------------
CREATE TABLE tax_slabs (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,  -- â†’ companies.id
    financial_year    VARCHAR(10)   NOT NULL,  -- e.g. '2024-25'
    min_income        NUMERIC(15,2) NOT NULL,
    max_income        NUMERIC(15,2),            -- NULL = no upper limit
    tax_rate_percent  DOUBLE PRECISION NOT NULL,
    surcharge_percent DOUBLE PRECISION DEFAULT 0,
    regime            VARCHAR(10)   NOT NULL DEFAULT 'NEW',  -- OLD | NEW
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);

COMMENT ON COLUMN tax_slabs.max_income    IS 'NULL for the top slab (no upper ceiling).';
COMMENT ON COLUMN tax_slabs.regime        IS 'OLD = pre-2023 regime with deductions; NEW = simplified flat slabs.';


-- ============================================================
-- 08_recruitment.sql
-- ============================================================
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
    company_id         UUID          NOT NULL,  -- â†’ companies.id
    department_id      UUID,                    -- â†’ departments.id
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
    hiring_manager_id  UUID,                    -- â†’ employees.id
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
-- ai_resume_score: 0â€“100 score from hrms-ai ResumeScoring service.
-- source: where the candidate came from (NAUKRI, LINKEDIN, REFERRAL, WALK_IN, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE candidates (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    company_id             UUID          NOT NULL,  -- â†’ companies.id
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
    referred_by_employee_id UUID,                   -- â†’ employees.id (for referral bonus tracking)
    ai_resume_score        DOUBLE PRECISION,         -- 0â€“100 from AI scoring service
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

COMMENT ON COLUMN candidates.ai_resume_score IS '0â€“100 score from hrms-ai ResumeScoring. NULL if not yet scored.';

-- -----------------------------------------------------------------------------
-- TABLE: job_applications
-- A candidate applying to a specific job posting.
-- status / current_stage mirrors the pipeline stage:
--   APPLIED â†’ SCREENING â†’ SHORTLISTED â†’ INTERVIEW â†’ OFFER â†’ HIRED | REJECTED | WITHDRAWN
-- hired_as_employee_id is set after onboarding converts candidate â†’ employee.
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
    hired_as_employee_id UUID,                    -- â†’ employees.id (set post-onboarding)
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
-- rating: 1â€“5 star rating by interviewer
-- -----------------------------------------------------------------------------
CREATE TABLE interviews (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    application_id   UUID          NOT NULL REFERENCES job_applications(id),
    candidate_id     UUID          NOT NULL,  -- â†’ candidates.id (denormalised for query convenience)
    interview_type   VARCHAR(30),              -- PHONE_SCREENING | TECHNICAL | MANAGERIAL | HR_ROUND | CASE_STUDY | PANEL
    scheduled_at     TIMESTAMPTZ,
    duration_minutes INT           DEFAULT 60,
    interviewer_ids  TEXT,                    -- JSON array of employees.id UUIDs
    meeting_link     TEXT,                    -- video call URL
    location         VARCHAR(255),            -- physical room/address for in-person
    status           VARCHAR(30)   DEFAULT 'SCHEDULED',  -- SCHEDULED | COMPLETED | CANCELLED | RESCHEDULED | NO_SHOW
    feedback         TEXT,
    rating           INT,                     -- 1â€“5
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
-- expires_at: offer validity date â€” auto-marked EXPIRED by a scheduled job.
-- -----------------------------------------------------------------------------
CREATE TABLE job_offers (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    application_id   UUID          NOT NULL REFERENCES job_applications(id),
    candidate_id     UUID          NOT NULL,  -- â†’ candidates.id
    job_posting_id   UUID          NOT NULL,  -- â†’ job_postings.id
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


-- ============================================================
-- 09_performance.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-performance
-- Tables: review_cycles, goals, performance_reviews
-- Purpose: OKR/goal management and 360-degree performance review workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: review_cycles
-- A named appraisal period (e.g. "H1 2025", "Annual 2025").
-- self_review_deadline: last date employees can submit self-assessment.
-- manager_review_deadline: last date managers can submit their rating.
-- Only one cycle per company should have is_active=true (enforced by app).
-- -----------------------------------------------------------------------------
CREATE TABLE review_cycles (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL,  -- â†’ companies.id
    name                    VARCHAR(200)  NOT NULL,  -- e.g. 'Annual Review 2025'
    start_date              DATE          NOT NULL,
    end_date                DATE          NOT NULL,
    self_review_deadline    DATE,
    manager_review_deadline DATE,
    is_active               BOOLEAN       NOT NULL DEFAULT true,
    year                    INT           NOT NULL,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    version                 BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_review_cycles_company ON review_cycles (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: goals
-- Individual OKR / KPI goal for an employee.
-- Can be linked to a review_cycle (for formal appraisals) or standalone (continuous).
-- is_company_goal: company-wide goal cascaded to the employee by HR.
-- status: NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | OVERDUE
-- weightage_percent: percentage contribution to overall performance score (sum should = 100).
-- -----------------------------------------------------------------------------
CREATE TABLE goals (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    employee_id      UUID          NOT NULL,  -- â†’ employees.id
    review_cycle_id  UUID          REFERENCES review_cycles(id),  -- NULL = standalone goal
    title            VARCHAR(300)  NOT NULL,
    description      TEXT,
    target_value     DOUBLE PRECISION,         -- quantitative target (e.g. 95 for 95% uptime)
    achieved_value   DOUBLE PRECISION,         -- actual achieved value (filled by employee)
    weightage_percent INT          DEFAULT 100,
    status           VARCHAR(30)   NOT NULL DEFAULT 'NOT_STARTED',  -- NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | OVERDUE
    due_date         DATE,
    category         VARCHAR(30),              -- e.g. TECHNICAL | LEADERSHIP | PROCESS | BUSINESS
    is_company_goal  BOOLEAN       DEFAULT false,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_goals_employee ON goals (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_cycle    ON goals (review_cycle_id);

COMMENT ON COLUMN goals.weightage_percent IS 'Contribution to overall score. All active goals for a review cycle should sum to 100.';
COMMENT ON COLUMN goals.is_company_goal   IS 'True when HR cascades a company-wide objective to employees.';

-- -----------------------------------------------------------------------------
-- TABLE: performance_reviews
-- One review record per (review_cycle, employee, reviewer, feedback_type).
-- feedback_type: SELF | MANAGER | PEER | UPWARD | HR
-- status: DRAFT | SUBMITTED | ACKNOWLEDGED
-- overall_rating: numeric score (e.g. 1.0â€“5.0 scale, configured per company).
-- reviewer_id = employee_id for SELF reviews.
-- -----------------------------------------------------------------------------
CREATE TABLE performance_reviews (
    id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID             NOT NULL,
    review_cycle_id  UUID             NOT NULL REFERENCES review_cycles(id),
    employee_id      UUID             NOT NULL,  -- â†’ employees.id (person being reviewed)
    reviewer_id      UUID             NOT NULL,  -- â†’ employees.id (person doing the review)
    feedback_type    VARCHAR(30)      NOT NULL,  -- SELF | MANAGER | PEER | UPWARD | HR
    overall_rating   DOUBLE PRECISION,            -- 1.0â€“5.0 (scale configurable per company)
    status           VARCHAR(30)      NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | ACKNOWLEDGED
    self_comment     TEXT,
    manager_comment  TEXT,
    hr_comment       TEXT,
    submitted_at     TIMESTAMPTZ,
    acknowledged_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reviews_employee ON performance_reviews (employee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON performance_reviews (reviewer_id, status);

COMMENT ON COLUMN performance_reviews.feedback_type IS 'SELF = employee reviews themselves; UPWARD = employee reviews manager.';


-- ============================================================
-- 10_learning.sql
-- ============================================================
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
-- target_role: optional â€” restricts mandatory auto-enroll to a specific role.
-- content_url: link to LMS content (S3 folder, external LMS URL, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE courses (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL,  -- â†’ companies.id
    title                   VARCHAR(300)  NOT NULL,
    description             TEXT,
    category                VARCHAR(100),             -- e.g. TECHNICAL | COMPLIANCE | SOFT_SKILLS | ONBOARDING
    duration_hours          INT           DEFAULT 0,
    status                  VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED | ARCHIVED
    thumbnail_url           TEXT,
    content_url             TEXT,                    -- LMS URL or object storage path
    is_mandatory            BOOLEAN       DEFAULT false,
    target_role             VARCHAR(50),              -- restrict auto-enroll: EMPLOYEE | DEPT_MANAGER | etc.
    created_by_employee_id  UUID,                    -- â†’ employees.id (course author)
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
-- progress_percent: 0â€“100; set to 100 when status = COMPLETED.
-- due_date: completion deadline (set when course is mandatory or assigned by manager).
-- -----------------------------------------------------------------------------
CREATE TABLE enrollments (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    course_id        UUID          NOT NULL REFERENCES courses(id),
    employee_id      UUID          NOT NULL,  -- â†’ employees.id
    status           VARCHAR(30)   NOT NULL DEFAULT 'ENROLLED',  -- ENROLLED | IN_PROGRESS | COMPLETED | DROPPED
    progress_percent INT           DEFAULT 0,  -- 0â€“100
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
    employee_id        UUID          NOT NULL,  -- â†’ employees.id (denormalised for fast lookups)
    course_id          UUID          NOT NULL,  -- â†’ courses.id (denormalised)
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


-- ============================================================
-- 11_expense.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-expense
-- Tables: expense_policies, expense_claims, expense_items
-- Purpose: Employee expense reimbursement â€” policy definition, claim submission,
--          manager approval, and finance reimbursement workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: expense_policies
-- Per-company rules for each expense category.
-- category (ExpenseCategory): TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION |
--   OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
-- max_amount_per_claim: NULL = no limit.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_policies (
    id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID          NOT NULL,
    company_id                UUID          NOT NULL,  -- â†’ companies.id
    name                      VARCHAR(200)  NOT NULL,
    category                  VARCHAR(50)   NOT NULL,  -- TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION | OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
    max_amount_per_claim      NUMERIC(15,2),            -- NULL = unlimited
    requires_receipt          BOOLEAN       DEFAULT true,
    requires_manager_approval BOOLEAN       DEFAULT true,
    requires_hr_approval      BOOLEAN       DEFAULT false,
    is_active                 BOOLEAN       DEFAULT true,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by                VARCHAR(255),
    updated_by                VARCHAR(255),
    version                   BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_policies_company ON expense_policies (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: expense_claims
-- An employee's reimbursement claim (header record).
-- status: DRAFT | SUBMITTED | APPROVED | REJECTED | REIMBURSED
-- total_amount: sum of all expense_items.amount (maintained by the app).
-- reimbursed_at: set by Finance after bank transfer.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_claims (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    employee_id      UUID          NOT NULL,  -- â†’ employees.id (claimant)
    company_id       UUID          NOT NULL,  -- â†’ companies.id
    title            VARCHAR(300)  NOT NULL,
    total_amount     NUMERIC(15,2) NOT NULL,
    currency         VARCHAR(10)   DEFAULT 'INR',
    status           VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | APPROVED | REJECTED | REIMBURSED
    submitted_at     TIMESTAMPTZ,
    approver_id      UUID,                    -- â†’ employees.id (manager who approves)
    approved_at      TIMESTAMPTZ,
    approver_comment TEXT,
    reimbursed_at    TIMESTAMPTZ,             -- set by Finance after payment
    notes            TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_claims_employee ON expense_claims (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_approver ON expense_claims (approver_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_company  ON expense_claims (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: expense_items
-- Individual line items within an expense claim.
-- category: same ExpenseCategory enum as expense_policies.
-- receipt_url: object storage path for uploaded receipt image/PDF.
-- Cascades delete with the parent claim.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_items (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    claim_id      UUID          NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
    category      VARCHAR(50)   NOT NULL,  -- TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION | OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
    description   TEXT,
    amount        NUMERIC(15,2) NOT NULL,
    expense_date  DATE          NOT NULL,
    receipt_url   TEXT,                    -- object storage path (generate signed URL per request)
    merchant_name VARCHAR(200),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_items_claim ON expense_items (claim_id);

COMMENT ON COLUMN expense_items.receipt_url IS 'Object storage path. Generate pre-signed URL per request; do not expose raw path.';


-- ============================================================
-- 12_notification.sql
-- ============================================================
-- =============================================================================
-- MODULE: hrms-notification
-- Tables: notifications
-- Purpose: Unified notification store for all delivery channels.
--          Produced by every other module via Spring Application Events.
--          Consumed by NotificationDispatchService (email/SMS/push/in-app).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: notifications
-- type (NotificationType):
--   LEAVE_REQUEST | LEAVE_APPROVED | LEAVE_REJECTED |
--   PAYSLIP_AVAILABLE | ATTENDANCE_ALERT |
--   EXPENSE_SUBMITTED | EXPENSE_APPROVED |
--   INTERVIEW_SCHEDULED | OFFER_EXTENDED |
--   GOAL_DUE | COURSE_ASSIGNED | GENERAL
--
-- channel (NotificationChannel): EMAIL | SMS | IN_APP | PUSH
--
-- reference_id + reference_type: polymorphic link back to the source entity.
--   e.g. reference_type=LEAVE_REQUEST, reference_id=<leave_requests.id>
--
-- action_url: deep-link URL opened when user taps the notification in the app.
-- is_sent: false until the dispatcher confirms delivery via provider API.
-- is_read: in-app read status; irrelevant for EMAIL/SMS channels.
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    recipient_id   UUID          NOT NULL,   -- â†’ employees.id
    type           VARCHAR(60)   NOT NULL,   -- see NotificationType enum above
    title          VARCHAR(300)  NOT NULL,
    body           TEXT,
    channel        VARCHAR(30),              -- EMAIL | SMS | IN_APP | PUSH
    is_read        BOOLEAN       NOT NULL DEFAULT false,
    read_at        TIMESTAMPTZ,
    reference_id   UUID,                    -- polymorphic source entity ID
    reference_type VARCHAR(60),             -- e.g. LEAVE_REQUEST, PAYSLIP, INTERVIEW
    action_url     TEXT,                    -- deep-link for mobile/web
    is_sent        BOOLEAN       NOT NULL DEFAULT false,
    sent_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant     ON notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_reference  ON notifications (reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_notifications_unsent     ON notifications (is_sent, channel) WHERE is_sent = false;

COMMENT ON COLUMN notifications.reference_type IS 'Source entity type: LEAVE_REQUEST | PAYSLIP | INTERVIEW | EXPENSE_CLAIM | GOAL | COURSE | etc.';
COMMENT ON COLUMN notifications.is_sent        IS 'True once delivery confirmed by email/SMS/push provider.';
COMMENT ON COLUMN notifications.action_url     IS 'Deep link opened when user taps notification. e.g. /leaves/123/review';


-- ============================================================
-- 13_seed_demo.sql
-- ============================================================
-- =============================================================================
-- SEED: Demo data for local development and smoke testing
-- Idempotent â€” safe to run multiple times (uses ON CONFLICT DO NOTHING).
--
-- Fixed IDs so every dev environment gets the same UUIDs:
--   tenant_id  : aaaaaaaa-0000-0000-0000-000000000001
--   company_id : bbbbbbbb-0000-0000-0000-000000000001
--   branch_id  : cccccccc-0000-0000-0000-000000000001
--   dept_id    : dddddddd-0000-0000-0000-000000000001
--   user+emp id: eeeeeeee-0000-0000-0000-000000000001
--
-- Login: admin@demo-corp.com / Admin@123
-- Roles: COMPANY_ADMIN, HR_MANAGER, DEPT_MANAGER, EMPLOYEE
-- =============================================================================

DO $$
DECLARE
    v_tenant_id   UUID := 'aaaaaaaa-0000-0000-0000-000000000001'::UUID;
    v_company_id  UUID := 'bbbbbbbb-0000-0000-0000-000000000001'::UUID;
    v_branch_id   UUID := 'cccccccc-0000-0000-0000-000000000001'::UUID;
    v_dept_id     UUID := 'dddddddd-0000-0000-0000-000000000001'::UUID;
    v_user_id     UUID := 'eeeeeeee-0000-0000-0000-000000000001'::UUID;
    v_lt_annual   UUID := '11111111-1111-0000-0000-000000000001'::UUID;
    v_lt_sick     UUID := '22222222-2222-0000-0000-000000000001'::UUID;
    v_lt_casual   UUID := '33333333-3333-0000-0000-000000000001'::UUID;
BEGIN

    -- Company (ENTERPRISE tier, 500 max employees)
    INSERT INTO companies (id, tenant_id, name, domain, subscription_tier,
                           max_employees, industry, country, timezone, currency, is_active)
    VALUES (v_company_id, v_tenant_id, 'Demo Corp', 'demo-corp', 'ENTERPRISE',
            500, 'Technology', 'India', 'Asia/Kolkata', 'INR', true)
    ON CONFLICT (id) DO NOTHING;

    -- Branch (Bangalore HQ â€” 50 km geofence for easy local testing)
    INSERT INTO branches (id, tenant_id, company_id, name, code, city, country,
                          latitude, longitude, geo_fence_radius_meters,
                          is_headquarters, is_active)
    VALUES (v_branch_id, v_tenant_id, v_company_id, 'Bangalore HQ', 'BLR-HQ',
            'Bangalore', 'India', 12.9716, 77.5946, 50000, true, true)
    ON CONFLICT (id) DO NOTHING;

    -- Department
    INSERT INTO departments (id, tenant_id, company_id, name, code, is_active)
    VALUES (v_dept_id, v_tenant_id, v_company_id, 'Engineering', 'ENG', true)
    ON CONFLICT (id) DO NOTHING;

    -- User credential â€” password: Admin@123 (BCrypt cost-10)
    INSERT INTO user_credentials (id, tenant_id, email, password_hash, is_active)
    VALUES (v_user_id, v_tenant_id, 'admin@demo-corp.com',
            '$2a$10$mY8mTIEuqWEQyJIUKzsuX.ipY68JolYl1xQZjMxvg8e8LObYNZU96', true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

    -- Grant all roles to demo admin
    INSERT INTO user_roles (user_credential_id, role)
    VALUES (v_user_id, 'COMPANY_ADMIN'),
           (v_user_id, 'HR_MANAGER'),
           (v_user_id, 'DEPT_MANAGER'),
           (v_user_id, 'EMPLOYEE')
    ON CONFLICT DO NOTHING;

    -- Employee (same UUID as user so JWT sub works as employeeId directly)
    INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name,
                           email, company_id, department_id, branch_id,
                           employment_type, employment_status, date_of_joining,
                           job_title, is_face_enrolled)
    VALUES (v_user_id, v_tenant_id, 'EMP001', 'Demo', 'Admin',
            'admin@demo-corp.com', v_company_id, v_dept_id, v_branch_id,
            'FULL_TIME', 'ACTIVE', CURRENT_DATE, 'Platform Administrator', false)
    ON CONFLICT (id) DO NOTHING;

    -- Link credential â†’ employee
    UPDATE user_credentials
    SET employee_id = v_user_id
    WHERE id = v_user_id AND employee_id IS NULL;

    -- Shift policy
    INSERT INTO shift_policies (id, tenant_id, company_id, name, shift_type,
                                start_time, end_time, grace_period_minutes,
                                working_hours_per_day, is_active)
    VALUES ('ffffffff-0000-0000-0000-000000000001'::UUID,
            v_tenant_id, v_company_id, 'Standard 9-6', 'FIXED',
            '09:00', '18:00', 30, 8.0, true)
    ON CONFLICT (id) DO NOTHING;

    -- Leave types
    INSERT INTO leave_types (id, tenant_id, company_id, name, code,
                             annual_entitlement, is_paid_leave, is_active)
    VALUES
        (v_lt_annual, v_tenant_id, v_company_id, 'Annual Leave',  'ANNUAL', 21, true, true),
        (v_lt_sick,   v_tenant_id, v_company_id, 'Sick Leave',    'SICK',   12, true, true),
        (v_lt_casual, v_tenant_id, v_company_id, 'Casual Leave',  'CASUAL',  6, true, true)
    ON CONFLICT (id) DO NOTHING;

    -- Leave balances for demo employee
    INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id,
                                year, total_entitlement, used, pending)
    VALUES
        (gen_random_uuid(), v_tenant_id, v_user_id, v_lt_annual,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT, 21, 3, 0),
        (gen_random_uuid(), v_tenant_id, v_user_id, v_lt_sick,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT, 12, 1, 0),
        (gen_random_uuid(), v_tenant_id, v_user_id, v_lt_casual,
         EXTRACT(YEAR FROM CURRENT_DATE)::INT,  6, 0, 0)
    ON CONFLICT ON CONSTRAINT uq_leave_balance DO NOTHING;

END $$;

