-- V143.3 — nightly purge of dead sign-in rows.
--
-- Found by the 2026-09-24 scalability review: nothing ever deleted
-- auth.refresh_tokens that expired or were revoked (a token is deleted only when
-- it is presented again, which an abandoned session never is) or
-- auth.otp_requests. Both grow with every sign-in, forever, and refresh
-- lookups scan them.
--
-- auth.refresh_tokens has FORCE ROW LEVEL SECURITY, so a nightly job cannot see
-- across workspaces; like V143.2 this is a narrow SECURITY DEFINER function
-- (owner holds BYPASSRLS on Cloud SQL, V081) that deletes only rows that are
-- provably dead:
--   refresh tokens  — expired, or revoked, more than a day ago;
--   OTP requests    — older than 30 days (kept that long for support questions;
--                     the codes themselves are stored hashed).
-- No employee, attendance, leave or payroll data is touched.
--
-- Numbered 143.3 so it cannot collide with a teammate's V144. Idempotent.

CREATE OR REPLACE FUNCTION auth.purge_dead_auth_rows()
RETURNS TABLE (refresh_tokens_deleted bigint, otp_requests_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
DECLARE
    rt bigint;
    otp bigint;
BEGIN
    DELETE FROM auth.refresh_tokens
     WHERE expires_at < now() - interval '1 day'
        OR revoked_at < now() - interval '1 day';
    GET DIAGNOSTICS rt = ROW_COUNT;

    DELETE FROM auth.otp_requests
     WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS otp = ROW_COUNT;

    RETURN QUERY SELECT rt, otp;
END $$;

REVOKE ALL ON FUNCTION auth.purge_dead_auth_rows() FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION auth.purge_dead_auth_rows() TO %I', r);
        END IF;
    END LOOP;
END $$;
