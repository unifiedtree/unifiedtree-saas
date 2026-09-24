-- V143.2 — sign-in, session refresh and phone-OTP sign-in find the workspace
-- in ONE indexed lookup instead of scanning every workspace.
--
-- Found by the 2026-09-24 scalability review. RLS hides other tenants' rows, so
-- AuthService.resolveLoginTenant (every email-only sign-in — the mobile app),
-- AuthService.refresh (every access-token renewal) and
-- PhoneLookupService.findByPhone (every OTP sign-in) each looped over ALL
-- active workspaces, binding app.tenant_id and querying each one: 2 queries per
-- workspace per call, and for phones a full scan of each workspace's
-- employees on a non-indexable expression. Fine at 13 workspaces; at 500 it is
-- ~1,000 queries per sign-in and per token refresh.
--
-- Same approach as auth.invitation_resolve (V041): narrow SECURITY DEFINER
-- functions owned by the migration role (which holds BYPASSRLS on Cloud SQL,
-- V081), returning only routing data — which workspace — for one email, one
-- 256-bit token hash, or one phone number. The caller then binds that tenant
-- and does everything else (password check, token rotation) under normal RLS.
-- EXECUTE is limited to the app roles.
--
-- Numbered 143.2 so it cannot collide with a teammate's V144. Idempotent.

-- Cross-tenant lookups need indexes led by the looked-up value.
CREATE INDEX IF NOT EXISTS idx_user_credentials_lower_email
    ON auth.user_credentials (lower(email::text));
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
    ON auth.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_employees_phone_last10
    ON hrms.employees ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));

-- The workspace an email signs in to: most recently used when it has several.
CREATE OR REPLACE FUNCTION auth.login_tenant_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, platform, pg_temp
AS $$
    SELECT c.tenant_id
      FROM auth.user_credentials c
      JOIN platform.tenants t ON t.id = c.tenant_id
     WHERE lower(c.email::text) = lower(btrim(p_email))
       AND t.status = 'ACTIVE'
     GROUP BY c.tenant_id
     ORDER BY max(c.last_login_at) DESC NULLS LAST, c.tenant_id
     LIMIT 1
$$;

-- The workspace that issued a refresh token (hash of a 256-bit random value).
CREATE OR REPLACE FUNCTION auth.refresh_token_tenant(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
    SELECT tenant_id FROM auth.refresh_tokens WHERE token_hash = p_token_hash LIMIT 1
$$;

-- The current employee (with an active login) whose phone ends in these 10
-- digits. "Current" = still employed: PROBATION and NOTICE_PERIOD count as well
-- as ACTIVE. The per-workspace loop this replaces matched ACTIVE only, so every
-- new hire (created as PROBATION — 33 of 56 employees in production on
-- 2026-09-24) was told their number "isn't on any workspace".
CREATE OR REPLACE FUNCTION auth.phone_login_match(p_last10 text)
RETURNS TABLE (tenant_id uuid, user_id uuid, employee_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, hrms, platform, pg_temp
AS $$
    SELECT e.tenant_id, c.id, e.id, e.email::text
      FROM hrms.employees e
      JOIN platform.tenants t ON t.id = e.tenant_id AND t.status = 'ACTIVE'
      JOIN auth.user_credentials c
        ON c.employee_id = e.id AND c.tenant_id = e.tenant_id AND c.is_active = true
     WHERE right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = p_last10
       AND e.is_active = true
       AND (e.employment_status IS NULL OR e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD'))
     ORDER BY c.last_login_at DESC NULLS LAST
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth.login_tenant_for_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.refresh_token_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.phone_login_match(text) FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA auth TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION auth.login_tenant_for_email(text) TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION auth.refresh_token_tenant(text) TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION auth.phone_login_match(text) TO %I', r);
        END IF;
    END LOOP;
END $$;
