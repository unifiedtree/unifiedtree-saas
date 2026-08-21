-- ============================================================================
-- V107 - Refresh tokens for the global account portal (/v1/accounts/auth/*)
-- ============================================================================
-- The account tier historically returned an access token only, so a browser
-- reload dropped the in-memory JWT and forced a full sign-in. Web UX (SaasWeb
-- landing + workspace switcher) needs a page reload to restore the session
-- without moving the long-lived credential into JavaScript-readable storage.
--
-- Web path: an httpOnly Secure SameSite=Lax cookie ut_acct_rt carries the
--   plain refresh token; script cannot read it, so an XSS bug cannot exfil it.
-- Mobile path: the plain refresh token can be supplied in the JSON body of
--   /v1/accounts/auth/refresh — mobile has no cookie jar and this keeps the
--   symmetric flow open (mirrors the tenant-scoped refresh contract on
--   CanonicalAuthController).
--
-- Cookie name is deliberately NOT tenant-scoped (unlike ut_rt_<tenantId>):
-- accounts precede tenants, and the account portal is where a user chooses
-- WHICH workspace to enter. One account → one refresh cookie.
--
-- Storage: sha256Hex of the plain token at rest — never plaintext. Compromise
-- of a DB snapshot must not hand the attacker replayable session credentials.
-- Rotation on every refresh (delete old row, insert new) blocks stolen-token
-- replay: a leaked token stops working the moment the legitimate client
-- refreshes with it.
--
-- No RLS on platform.* (see V002 / V087 comment) — account_refresh_tokens is
-- platform-global (one row per session, keyed by account_id), so ut_app just
-- needs table DML.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.account_refresh_tokens (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID         NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    token_hash   CHAR(64)     NOT NULL UNIQUE,
    issued_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL,
    revoked_at   TIMESTAMPTZ,
    user_agent   VARCHAR(512),
    request_ip   VARCHAR(64)
);

-- "list active sessions for this user" query — future account settings screen
-- ("Signed in on these devices; sign this one out"). ORDER BY expires_at DESC
-- so the newest live session sorts first.
CREATE INDEX IF NOT EXISTS idx_account_refresh_tokens_account_expires
    ON platform.account_refresh_tokens (account_id, expires_at DESC);

COMMENT ON TABLE platform.account_refresh_tokens IS
    'Refresh tokens for the global account portal (/v1/accounts/auth/*). '
    'token_hash is sha256 of the plain token; plain value only ever lives in '
    'the httpOnly ut_acct_rt cookie or in the mobile client. Rotated on every '
    'refresh — the old row is deleted and a new one inserted.';

-- ut_app (NOSUPERUSER/NOBYPASSRLS) needs full DML — issue on login,
-- delete-then-insert on refresh (rotation), UPDATE revoked_at + DELETE on
-- logout. Guarded so the migration also runs where no ut_app role exists
-- (integration-test containers, fresh local dev DB) — same pattern as V084/V088.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.account_refresh_tokens TO ut_app;
    END IF;
END $$;
