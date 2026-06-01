-- ============================================================================
-- V003 - auth schema: user credentials, OTP, refresh tokens
-- ============================================================================
-- RLS on. Every row has tenant_id; queries set app.tenant_id per transaction.
-- Platform-level admin accounts use tenant_id = the special platform tenant UUID.
-- ============================================================================

CREATE TABLE auth.user_credentials (
    id                   UUID            PRIMARY KEY,
    tenant_id            UUID            NOT NULL,
    email                VARCHAR(255)    NOT NULL,
    mobile_number        VARCHAR(20),
    password_hash        VARCHAR(255),
    employee_id          UUID,
    is_active            BOOLEAN         NOT NULL DEFAULT TRUE,
    is_biometric_enabled BOOLEAN         NOT NULL DEFAULT FALSE,
    last_login_at        TIMESTAMPTZ,
    failed_login_count   INT             NOT NULL DEFAULT 0,
    locked_until         TIMESTAMPTZ,
    password_updated_at  TIMESTAMPTZ,
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_auth_user_tenant_email  UNIQUE (tenant_id, email),
    CONSTRAINT uq_auth_user_tenant_mobile UNIQUE (tenant_id, mobile_number)
);

CREATE INDEX idx_user_credentials_tenant ON auth.user_credentials(tenant_id);
CREATE INDEX idx_user_credentials_employee ON auth.user_credentials(tenant_id, employee_id);

ALTER TABLE auth.user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_credentials ON auth.user_credentials
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE auth.otp_codes (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    mobile_number   VARCHAR(20)     NOT NULL,
    code_hash       VARCHAR(255)    NOT NULL,
    purpose         VARCHAR(30)     NOT NULL DEFAULT 'LOGIN',
    attempts        INT             NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ     NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_lookup ON auth.otp_codes(tenant_id, mobile_number, purpose, expires_at);

ALTER TABLE auth.otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_otp ON auth.otp_codes
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE auth.refresh_tokens (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    user_id         UUID            NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255)    NOT NULL,
    device_fingerprint VARCHAR(255),
    user_agent      VARCHAR(255),
    issued_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ     NOT NULL,
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user ON auth.refresh_tokens(tenant_id, user_id);
CREATE INDEX idx_refresh_tokens_lookup ON auth.refresh_tokens(tenant_id, token_hash) WHERE revoked_at IS NULL;

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refresh_tokens ON auth.refresh_tokens
    USING (tenant_id = current_tenant_id());
