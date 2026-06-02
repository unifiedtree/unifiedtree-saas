-- ============================================================================
-- V039 - Invitation token table + invited_at column on user_credentials
-- ----------------------------------------------------------------------------
-- Supports two flows:
--   INVITATION    — HR invites a new employee; link valid 72 h
--   PASSWORD_RESET — self-service reset; link valid 1 h
--
-- Raw tokens are Base64URL-encoded 32-byte randoms.
-- Only the SHA-256 hex of the token is stored here (never the raw value).
-- ============================================================================

-- Add invited_at to auth.user_credentials so invitation status is visible
ALTER TABLE auth.user_credentials ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth.invitation_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    user_id     UUID        NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL,
    purpose     VARCHAR(20)  NOT NULL CHECK (purpose IN ('INVITATION','PASSWORD_RESET')),
    expires_at  TIMESTAMPTZ  NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  UUID,
    CONSTRAINT uq_invitation_token_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_invitation_tokens_user
    ON auth.invitation_tokens (user_id) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_expires
    ON auth.invitation_tokens (expires_at) WHERE used_at IS NULL;

-- Row-level security — tenant isolation same pattern as auth.user_credentials
ALTER TABLE auth.invitation_tokens ENABLE  ROW LEVEL SECURITY;
ALTER TABLE auth.invitation_tokens FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_tenant_isolation ON auth.invitation_tokens;
CREATE POLICY invitation_tenant_isolation ON auth.invitation_tokens
    USING      (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Grants (hrms_app role used by the Spring app data source)
GRANT SELECT, INSERT, UPDATE ON auth.invitation_tokens TO hrms_app;

-- Verification
DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM information_schema.tables
     WHERE table_schema = 'auth' AND table_name = 'invitation_tokens';
    RAISE NOTICE 'auth.invitation_tokens created: %', (c = 1);
END $$;
