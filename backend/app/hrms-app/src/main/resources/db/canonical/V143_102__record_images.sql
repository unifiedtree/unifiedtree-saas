-- V143.102: employee photos, branch logos and staffing-agency logos (testers' Workforce feedback, 6 Oct).
--
-- One small image per record, kept in the database so it works with or without R2 (as the workspace logo,
-- V143.15). The server re-checks every upload (JPG or PNG by magic bytes, at most 2 MB, 64 to 6000 px), then
-- re-encodes it at no more than 512 px (a photo is cropped to a square JPG, a logo keeps its shape as PNG), so
-- a row stays small and no camera metadata (location) is kept.
--
-- hrms.record_images: one row per (tenant, kind, record). kind = EMPLOYEE (hrms.employees.id), BRANCH
-- (org.branches.id) or AGENCY (hrms.contractors.id). token = a random UUID, new on every upload: the image is
-- served at the public address /v1/public/images/{tenant}/{token} (no sign-in, as the workspace logo is) so an
-- <img> can show it; the token is unguessable and changes when the image changes.
-- An employee photo's address is also written to hrms.employees.profile_photo_url and to the person's login
-- (auth.user_credentials.avatar_url), so every list that already shows profilePhotoUrl shows it. No column is
-- added to any table a JPA entity maps.
--
-- hrms.public_record_image(tenant, token): the one public read, SECURITY DEFINER (its owner bypasses row-level
-- security, as auth.invitation_resolve does; V081 gave the migration role BYPASSRLS on Cloud SQL). It returns
-- only the content type and the bytes of the one row that matches both the tenant and the token.
--
-- No new permission: uploads use hrms.employee.write (or the person themself), org.company.write (branches)
-- and hrms.contractor.write (agencies), so OwnerPermissionInvariantCheck is unaffected. Until this file is
-- applied the upload endpoints answer FEATURE_NOT_READY and the pages show their initials and icons as today.
--
-- Numbered 143.102 (reserved). Idempotent. Production has Flyway OFF: apply by hand, as the table owner.

CREATE TABLE IF NOT EXISTS hrms.record_images (
    tenant_id     UUID         NOT NULL,
    kind          VARCHAR(20)  NOT NULL,
    record_id     UUID         NOT NULL,
    token         UUID         NOT NULL,
    content_type  VARCHAR(40)  NOT NULL,
    bytes         BYTEA        NOT NULL,
    width         INTEGER,
    height        INTEGER,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by    VARCHAR(255),
    CONSTRAINT pk_record_images PRIMARY KEY (tenant_id, kind, record_id),
    CONSTRAINT uq_record_images_token UNIQUE (token),
    CONSTRAINT ck_record_images_kind CHECK (kind IN ('EMPLOYEE', 'BRANCH', 'AGENCY')),
    CONSTRAINT ck_record_images_type CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT ck_record_images_size CHECK (octet_length(bytes) <= 2097152)
);

COMMENT ON TABLE hrms.record_images IS
    'Employee photos, branch logos and agency logos (V143.102): one re-encoded image per record, served at /v1/public/images/{tenant}/{token}. JDBC only.';

ALTER TABLE hrms.record_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.record_images FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'record_images'
                      AND policyname = 'tenant_isolation_record_images') THEN
        CREATE POLICY tenant_isolation_record_images ON hrms.record_images
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

CREATE OR REPLACE FUNCTION hrms.public_record_image(p_tenant UUID, p_token UUID)
RETURNS TABLE (content_type VARCHAR, bytes BYTEA)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hrms, pg_temp
AS $$
    SELECT r.content_type, r.bytes
      FROM hrms.record_images r
     WHERE r.tenant_id = p_tenant AND r.token = p_token
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION hrms.public_record_image(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.record_images TO ut_app;
        GRANT EXECUTE ON FUNCTION hrms.public_record_image(UUID, UUID) TO ut_app;
    ELSE
        RAISE NOTICE 'V143.102: role ut_app not present — grants skipped';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.record_images TO hrms_app;
        GRANT EXECUTE ON FUNCTION hrms.public_record_image(UUID, UUID) TO hrms_app;
    END IF;
END $$;
