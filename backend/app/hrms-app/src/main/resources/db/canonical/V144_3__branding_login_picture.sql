-- ============================================================================
-- V144_3 - The business's sign-in picture
-- ============================================================================
-- Owner (6 Oct 2026): the business login page shows a large picture beside the
-- sign-in, one per business (not per company); our brand panel until a business
-- uploads its own (Settings -> Branding -> Sign-in picture). Same storage as the
-- logo, mark and letterhead (V143_15, V143_100): bytes on the tenant_branding row.
--
-- Applying by hand (Flyway is OFF in production), as the owner role, one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f V144_3__branding_login_picture.sql
-- lock_timeout = 5s: if the ALTER can't get its lock it fails (nothing applied) instead of
-- queueing sign-in page requests behind it; re-run it when traffic is lower. Idempotent. Until it
-- is applied the picture reads as "none" and an upload answers 503 plainly.
-- Rollback: ALTER TABLE platform.tenant_branding DROP COLUMN login_url, ... (the 7 below).
-- ============================================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE platform.tenant_branding
    ADD COLUMN IF NOT EXISTS login_url          TEXT,
    ADD COLUMN IF NOT EXISTS login_r2_key       TEXT,
    ADD COLUMN IF NOT EXISTS login_bytes        BYTEA,
    ADD COLUMN IF NOT EXISTS login_content_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS login_width        INTEGER,
    ADD COLUMN IF NOT EXISTS login_height       INTEGER,
    ADD COLUMN IF NOT EXISTS login_version      VARCHAR(20);
