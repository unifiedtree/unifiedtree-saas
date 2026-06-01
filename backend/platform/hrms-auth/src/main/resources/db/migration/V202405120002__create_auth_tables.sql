CREATE TABLE user_credentials (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    email                 VARCHAR(255) NOT NULL,
    password_hash         VARCHAR(255) NOT NULL,
    employee_id           UUID,
    is_active             BOOLEAN     NOT NULL DEFAULT true,
    is_mfa_enabled        BOOLEAN     NOT NULL DEFAULT false,
    mfa_secret            VARCHAR(255),
    failed_login_attempts INT         NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    password_changed_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT      NOT NULL DEFAULT 0,
    CONSTRAINT uq_user_credentials_tenant_email UNIQUE (tenant_id, email)
);

CREATE TABLE user_roles (
    user_credential_id UUID        NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
    role               VARCHAR(50) NOT NULL,
    PRIMARY KEY (user_credential_id, role)
);

CREATE TABLE refresh_tokens (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    user_credential_id UUID        NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
    token_hash         VARCHAR(512) NOT NULL UNIQUE,
    expires_at         TIMESTAMPTZ  NOT NULL,
    revoked            BOOLEAN      NOT NULL DEFAULT false,
    device_fingerprint VARCHAR(255),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT       NOT NULL DEFAULT 0
);

CREATE INDEX idx_user_credentials_tenant_email ON user_credentials (tenant_id, email);
CREATE INDEX idx_user_credentials_employee_id  ON user_credentials (employee_id);
CREATE INDEX idx_refresh_tokens_token_hash      ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user_id         ON refresh_tokens (user_credential_id);
