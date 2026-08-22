-- ============================================================================
-- V108 - Google OAuth support for the global account portal
-- ============================================================================
-- Wires Google as an IdP for /v1/accounts/auth/google/{start,callback}.
-- Google login is AUTH ONLY: it never mints a workspace, never touches
-- Razorpay, never inserts into platform.tenants. The callback ends by
-- writing the same ut_acct_rt refresh cookie the password login writes,
-- and returning the same AccountLoginResponse shape.
--
-- Two changes:
--   1. platform.accounts gains google_sub + google_avatar_url and the
--      password_hash column becomes nullable so a Google-only user can
--      exist without a password. A guard CHECK enforces that every row
--      still has *some* credential (password_hash OR google_sub).
--   2. New auth.oauth_state single-use table keyed by state UUID; carries
--      the PKCE verifier and nonce for the /callback step so a replay
--      cannot mint a second session with the same state.
--
-- Idempotent: uses IF NOT EXISTS + guarded DO blocks, matches the pattern
-- used by V107, V084, V088.
--
-- No RLS on platform.* / auth.oauth_state — both are platform-global and
-- ut_app just needs table DML.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. platform.accounts: relax password_hash + add Google metadata columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE platform.accounts
    ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE platform.accounts
    ADD COLUMN IF NOT EXISTS google_sub         VARCHAR(64),
    ADD COLUMN IF NOT EXISTS google_avatar_url  TEXT,
    ADD COLUMN IF NOT EXISTS given_name         VARCHAR(150),
    ADD COLUMN IF NOT EXISTS family_name        VARCHAR(150),
    ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN NOT NULL DEFAULT FALSE;

-- Every row MUST have at least one credential path. Without this a bug
-- that clears the password on a Google-linked account would leave a row
-- with no way to sign in and no way to notice from schema alone.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_accounts_has_auth'
           AND conrelid = 'platform.accounts'::regclass
    ) THEN
        ALTER TABLE platform.accounts
            ADD CONSTRAINT ck_accounts_has_auth
            CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);
    END IF;
END $$;

-- One Google account = one platform account. Partial index so existing
-- rows without a google_sub (all of them, right now) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_google_sub
    ON platform.accounts(google_sub)
    WHERE google_sub IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. auth.oauth_state — single-use state row per /start call
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.oauth_state (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    state_token    UUID          NOT NULL UNIQUE,
    provider       VARCHAR(32)   NOT NULL DEFAULT 'google',
    code_verifier  TEXT          NOT NULL,
    nonce          VARCHAR(64)   NOT NULL,
    return_to      VARCHAR(256)  NOT NULL DEFAULT '/workspaces',
    request_ip     VARCHAR(64),
    user_agent     VARCHAR(512),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_expiry
    ON auth.oauth_state (expires_at);

COMMENT ON TABLE auth.oauth_state IS
    'PKCE + nonce state rows for /v1/accounts/auth/google. Single-use: '
    'DELETEd at /callback before token exchange so replay of the same '
    'state cannot mint two sessions. TTL 10 minutes.';

-- ut_app needs DML — /start inserts, /callback selects + deletes.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA auth TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_state TO ut_app;
    END IF;
END $$;
