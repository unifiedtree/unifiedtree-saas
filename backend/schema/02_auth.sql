-- =============================================================================
-- MODULE: hrms-auth
-- Tables: user_credentials, user_roles, refresh_tokens
-- Purpose: Authentication credentials and session management.
--          Identity is separate from employee profile (hrms-employee).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: user_credentials
-- One row per login identity. Linked to an employee via employee_id after onboarding.
-- Unique per (tenant_id, email) — the same email can exist in different tenants.
-- -----------------------------------------------------------------------------
CREATE TABLE user_credentials (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    email                 VARCHAR(255)  NOT NULL,
    mobile_number         VARCHAR(20),
    password_hash         VARCHAR(255)  NOT NULL,           -- BCrypt cost-10
    employee_id           UUID,                             -- → employees.id (set after onboarding)
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
