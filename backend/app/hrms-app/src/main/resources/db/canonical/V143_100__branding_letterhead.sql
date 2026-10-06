-- V143.100: a letterhead image of its own (audit H-55, client 27 Sep: "upload previews for logo,
-- letterhead and templates").
--
-- Until now a letter's or a payslip's header was the workspace's wide logo beside the company name
-- (WorkspaceLetterhead). A workspace can now upload a full-width letterhead banner instead; when one
-- is set, generated letters, payslips and the salary register open with it. With none set, nothing
-- changes.
--
-- Same storage as the logo and the mark (V143_15): the bytes on the platform.tenant_branding row
-- (and a best-effort R2 copy), so PDFs embed it without a network call. Only columns, no new table,
-- no new permission (settings.branding.write already guards uploads). Read and written with
-- JdbcTemplate only (no JPA entity maps this table). BrandingService checks these columns exist
-- before touching them, so the app runs the same before this migration is applied.
--
-- Idempotent.

ALTER TABLE platform.tenant_branding
    ADD COLUMN IF NOT EXISTS letterhead_url          TEXT,
    ADD COLUMN IF NOT EXISTS letterhead_r2_key       TEXT,
    ADD COLUMN IF NOT EXISTS letterhead_bytes        BYTEA,
    ADD COLUMN IF NOT EXISTS letterhead_content_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS letterhead_width        INTEGER,
    ADD COLUMN IF NOT EXISTS letterhead_height       INTEGER,
    ADD COLUMN IF NOT EXISTS letterhead_version      VARCHAR(20);
