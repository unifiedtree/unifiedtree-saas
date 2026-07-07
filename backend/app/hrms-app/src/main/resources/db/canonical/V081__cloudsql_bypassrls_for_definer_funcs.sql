-- ============================================================================
-- V081 - Fix accept-invite / reset-password on Cloud SQL
-- ----------------------------------------------------------------------------
-- V041 introduced auth.invitation_resolve() as SECURITY DEFINER, assuming its
-- owner (postgres, the migration role) is a cluster superuser and thus
-- implicitly bypasses RLS. That assumption holds on self-hosted Postgres and
-- on Railway (`postgres` was superuser there), but NOT on Google Cloud SQL —
-- the tenant-visible "postgres" role there is a member of `cloudsqlsuperuser`
-- and lacks the true SUPERUSER + BYPASSRLS attributes.
--
-- Result on Cloud SQL: the DEFINER function ran as postgres, hit FORCE ROW
-- LEVEL SECURITY on auth.invitation_tokens with no `app.tenant_id` set, and
-- always returned zero rows — every accept-invite / reset-password call 422'd
-- with "Invitation link is invalid or has already been used".
--
-- Fix: explicitly grant BYPASSRLS to the function's owner. BYPASSRLS is a
-- lower privilege than SUPERUSER, and Cloud SQL permits granting it via
-- ALTER ROLE. Idempotent + safe on Railway (postgres already had it via
-- SUPERUSER).
-- ============================================================================

DO $$
DECLARE
    fn_owner text;
BEGIN
    SELECT r.rolname INTO fn_owner
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_roles r ON p.proowner = r.oid
     WHERE n.nspname = 'auth' AND p.proname = 'invitation_resolve'
     LIMIT 1;

    IF fn_owner IS NULL THEN
        RAISE NOTICE 'auth.invitation_resolve() not found - skipping BYPASSRLS grant (run V041 first)';
        RETURN;
    END IF;

    EXECUTE format('ALTER ROLE %I BYPASSRLS', fn_owner);
    RAISE NOTICE 'Granted BYPASSRLS to %, owner of auth.invitation_resolve()', fn_owner;
END $$;
