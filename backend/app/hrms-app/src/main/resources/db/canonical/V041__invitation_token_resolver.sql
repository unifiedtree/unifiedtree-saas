-- ============================================================================
-- V041 - SECURITY DEFINER resolver for invitation/reset tokens
-- ----------------------------------------------------------------------------
-- The accept-invite and reset-password flows are PUBLIC (no JWT, no tenant
-- context). They must look up a token by its hash BEFORE the tenant is known.
--
-- auth.invitation_tokens has FORCE ROW LEVEL SECURITY with a tenant-isolation
-- policy. Under a non-superuser app role (hrms_app), a SELECT with no
-- app.tenant_id set returns zero rows — so the public flows could never find
-- their own token. (It only "worked" when the app connected as a superuser,
-- which bypasses RLS — not safe for production.)
--
-- This SECURITY DEFINER function runs as its owner (the migration superuser),
-- which bypasses RLS, and returns ONLY the minimal routing fields for a single
-- token looked up by its globally-unique hash. The token hash is a 256-bit
-- random value, so resolving it leaks nothing about other tenants.
--
-- The caller then SET LOCAL app.tenant_id to the returned tenant and performs
-- all subsequent reads/writes under normal RLS.
-- ============================================================================

CREATE OR REPLACE FUNCTION auth.invitation_resolve(p_token_hash VARCHAR)
RETURNS TABLE (
    id          UUID,
    tenant_id   UUID,
    user_id     UUID,
    purpose     VARCHAR,
    expires_at  TIMESTAMPTZ,
    used_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
    SELECT id, tenant_id, user_id, purpose, expires_at, used_at
      FROM auth.invitation_tokens
     WHERE token_hash = p_token_hash
     LIMIT 1;
$$;

-- The app role may execute it; the function body bypasses RLS via DEFINER rights.
GRANT EXECUTE ON FUNCTION auth.invitation_resolve(VARCHAR) TO hrms_app;

DO $$
BEGIN
    RAISE NOTICE 'auth.invitation_resolve() created';
END $$;
