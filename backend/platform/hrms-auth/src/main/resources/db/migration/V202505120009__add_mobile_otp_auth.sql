ALTER TABLE user_credentials
    ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS is_biometric_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credentials_tenant_mobile
    ON user_credentials (tenant_id, mobile_number)
    WHERE mobile_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    code_hash VARCHAR(512) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'LOGIN',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    device_fingerprint VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_otp_mobile_created
    ON auth_otp_challenges (tenant_id, mobile_number, created_at DESC);
