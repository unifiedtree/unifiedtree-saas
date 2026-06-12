-- ============================================================================
-- Email-only login resolver.
--
-- The mobile app sends only { email, password } (no workspace field). The
-- backend resolves which workspace the email belongs to via this function.
--
-- auth.user_credentials has FORCE ROW LEVEL SECURITY, so no app-role query can
-- read it across tenants. This SECURITY DEFINER function MUST be created by a
-- superuser / BYPASSRLS role (the Railway Postgres "Query" tab connects as the
-- `postgres` superuser, so running it there makes `postgres` the owner and the
-- SECURITY DEFINER bypass works).
--
-- Returns the tenant_id ONLY when the email is globally unique across all
-- workspaces (0 matches -> NULL = unknown; >1 -> NULL = ambiguous). The Java
-- caller treats NULL as a generic "invalid email or password".
--
-- EXECUTE is granted to PUBLIC by default, which includes ut_app (the app role).
-- ============================================================================

CREATE OR REPLACE FUNCTION auth.resolve_login_tenant(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_tenant uuid;
  v_count  int;
BEGIN
  SELECT count(*) INTO v_count
    FROM auth.user_credentials
   WHERE lower(email) = lower(p_email);

  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT tenant_id INTO v_tenant
    FROM auth.user_credentials
   WHERE lower(email) = lower(p_email)
   LIMIT 1;

  RETURN v_tenant;
END $$;
