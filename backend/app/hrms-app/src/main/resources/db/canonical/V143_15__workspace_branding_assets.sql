-- V143.15: white-label workspace branding.
--
-- Customers must never see the vendor's name or logo inside their workspace.
-- Each workspace now carries two images of its own:
--   * the wide logo   (sign-in page, payslip / register / letter headers)
--   * the square mark (app rail, mobile header, splash, browser tab icon)
-- With neither uploaded, the web app draws a monogram: the first letter of the
-- workspace name, in the app's existing colours.
--
-- The image bytes are kept on the platform.tenant_branding row as well as in
-- R2 (when R2 is configured), so:
--   * the sign-in page and the browser tab icon load from a stable, versioned
--     API address that never expires (a presigned R2 link expires in 7 days);
--   * PDFs can embed the logo without a network call;
--   * a deployment without R2 (local, staging) still works end to end.
-- Uploads are limited to 2 MB and re-validated by the server (magic bytes,
-- dimensions of at least 128 px on the shortest side), so the row stays small.
--
-- platform.* tables have no RLS by design (V087): the row is keyed by
-- tenant_id and every read/write in BrandingService filters on it. No new
-- table is created here, only columns.
--
-- Permission settings.branding.write replaces the old role-name check in
-- BrandingController. OWNER and SUPER_ADMIN must hold every permission
-- (OwnerPermissionInvariantCheck); ADMIN is the workspace admin who could
-- already change the logo.
--
-- Idempotent. Numbered 143.15 so it cannot collide with a teammate's V144.

ALTER TABLE platform.tenant_branding
    ADD COLUMN IF NOT EXISTS logo_bytes        BYTEA,
    ADD COLUMN IF NOT EXISTS logo_content_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS logo_width        INTEGER,
    ADD COLUMN IF NOT EXISTS logo_height       INTEGER,
    ADD COLUMN IF NOT EXISTS logo_version      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS mark_url          TEXT,
    ADD COLUMN IF NOT EXISTS mark_r2_key       TEXT,
    ADD COLUMN IF NOT EXISTS mark_bytes        BYTEA,
    ADD COLUMN IF NOT EXISTS mark_content_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS mark_width        INTEGER,
    ADD COLUMN IF NOT EXISTS mark_height       INTEGER,
    ADD COLUMN IF NOT EXISTS mark_version      VARCHAR(20);

-- Same guard the app enforces, so a bad write can never reach a PDF or a page.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_branding_logo_size') THEN
        ALTER TABLE platform.tenant_branding
            ADD CONSTRAINT ck_tenant_branding_logo_size
            CHECK (logo_bytes IS NULL OR octet_length(logo_bytes) <= 2097152);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_branding_mark_size') THEN
        ALTER TABLE platform.tenant_branding
            ADD CONSTRAINT ck_tenant_branding_mark_size
            CHECK (mark_bytes IS NULL OR octet_length(mark_bytes) <= 2097152);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.tenant_branding TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.tenant_branding TO hrms_app;
    END IF;
END $$;

INSERT INTO rbac.permissions (code, display_name, module, description)
     VALUES ('settings.branding.write', 'Change workspace branding', 'settings',
             'Upload, replace or remove the workspace logo and square mark. They are shown to '
             || 'everyone in this workspace: on the sign-in page, in the app header, on the '
             || 'browser tab, and on payslips, salary registers and letters.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'settings.branding.write'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN')
ON CONFLICT DO NOTHING;
