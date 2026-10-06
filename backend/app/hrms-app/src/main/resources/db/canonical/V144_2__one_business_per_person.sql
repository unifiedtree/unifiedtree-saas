-- ============================================================================
-- V144_2 - One business per person: is this email already in another business?
-- ============================================================================
-- Owner decision (6 Oct 2026): a person belongs to one business only — they
-- cannot own one and be invited into another. InvitationService asks this
-- before it creates a login for an email in a business.
--
-- auth.user_credentials is row-level-secured per business, so the check is a
-- narrow SECURITY DEFINER function (same approach as auth.login_tenant_for_email,
-- V143_2): it answers yes/no only, never which business.
-- Counts any login row (also a pending invite) in another ACTIVE business, and
-- any active account membership (an owner's account) in another business.
--
-- Flyway is OFF in production: apply by hand as the owner. Idempotent.
-- Until it is applied the invite check is skipped (the code looks for the function).
-- Rollback: DROP FUNCTION auth.email_signs_in_elsewhere(text, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION auth.email_signs_in_elsewhere(p_email text, p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, platform, pg_temp
AS $$
    SELECT EXISTS (
               SELECT 1
                 FROM auth.user_credentials c
                 JOIN platform.tenants t ON t.id = c.tenant_id
                WHERE lower(c.email::text) = lower(btrim(p_email))
                  AND c.tenant_id <> p_tenant
                  AND t.status = 'ACTIVE')
        OR EXISTS (
               SELECT 1
                 FROM platform.accounts a
                 JOIN platform.account_workspaces aw ON aw.account_id = a.id AND aw.status = 'ACTIVE'
                 JOIN platform.tenants t ON t.id = aw.tenant_id AND t.status = 'ACTIVE'
                WHERE lower(a.email::text) = lower(btrim(p_email))
                  AND aw.tenant_id <> p_tenant)
$$;

REVOKE ALL ON FUNCTION auth.email_signs_in_elsewhere(text, uuid) FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA auth TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION auth.email_signs_in_elsewhere(text, uuid) TO %I', r);
        END IF;
    END LOOP;
END $$;
