-- V143.26: Workspace Settings -> Security, Profile and Danger zone (w2g).
--
-- 1. Two-factor sign-in (TOTP, Google Authenticator and similar apps) on the
--    sign-in account. is_mfa_enabled is the same flag the legacy auth schema
--    carried; the canonical auth.user_credentials never had it. The secret is
--    stored AES-GCM encrypted (FieldEncryptor), never in plain text. A pending
--    secret is kept while the person scans the QR code and is promoted only
--    after they type a correct code. mfa_last_used_step stops the same 6-digit
--    code being replayed inside its 30-second window.
-- 2. Recovery codes: ten single-use codes per person, stored as keyed hashes
--    (HMAC-SHA256 with a server key), never in plain text.
-- 3. Active sessions: a refresh token row IS a session. Rotation replaces the
--    row on every refresh, so session_id carries the stable id across
--    rotations (the access token carries it as the "sid" claim, so a signed-out
--    session stops working straight away, not when its access token expires).
--    user_agent existed but was never filled; ip_address, session_started_at
--    and last_used_at are new. Existing rows get session_id = id.
-- 4. Workspace sign-in rule: platform.tenants.mfa_policy
--      OFF      - two-factor is optional (the default, also for new workspaces)
--      ADMINS   - required for owners, super admins, admins, HR managers and
--                 finance leads when they sign in with a password
--      EVERYONE - required for everyone who signs in with a password
-- 5. Workspace data export jobs (zip of CSVs per module, built in the
--    background, downloadable for 7 days).
-- 6. Workspace reset / delete REQUESTS. Nothing is ever deleted by the app:
--    a request is scheduled 7 days out, can be cancelled until then, and every
--    owner and admin is emailed. When the 7 days pass the request becomes DUE
--    and the platform operator carries it out after taking a backup.
-- 7. Four permissions (each granted to OWNER and SUPER_ADMIN, which hold every
--    permission; see OwnerPermissionInvariantCheck).
--
-- Numbered 143.26 so it cannot collide with a teammate's migration. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Two-factor columns on the sign-in account
-- ---------------------------------------------------------------------------
ALTER TABLE auth.user_credentials
    ADD COLUMN IF NOT EXISTS is_mfa_enabled         BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS mfa_secret_enc         TEXT,
    ADD COLUMN IF NOT EXISTS mfa_enabled_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT,
    ADD COLUMN IF NOT EXISTS mfa_pending_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mfa_last_used_step     BIGINT,
    ADD COLUMN IF NOT EXISTS mfa_failed_count       INTEGER     NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Recovery codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.mfa_recovery_codes (
    id         UUID PRIMARY KEY,
    tenant_id  UUID         NOT NULL,
    user_id    UUID         NOT NULL REFERENCES auth.user_credentials (id) ON DELETE CASCADE,
    code_hash  VARCHAR(128) NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user
    ON auth.mfa_recovery_codes (tenant_id, user_id);

ALTER TABLE auth.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'auth' AND tablename = 'mfa_recovery_codes'
                      AND policyname = 'tenant_isolation_mfa_recovery_codes') THEN
        CREATE POLICY tenant_isolation_mfa_recovery_codes ON auth.mfa_recovery_codes
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sessions on the refresh-token store
-- ---------------------------------------------------------------------------
ALTER TABLE auth.refresh_tokens
    ADD COLUMN IF NOT EXISTS session_id         UUID,
    ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_used_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ip_address         VARCHAR(64);

UPDATE auth.refresh_tokens SET session_id = id WHERE session_id IS NULL;
UPDATE auth.refresh_tokens SET session_started_at = issued_at WHERE session_started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session
    ON auth.refresh_tokens (tenant_id, session_id);

-- ---------------------------------------------------------------------------
-- 4. Workspace sign-in rule
-- ---------------------------------------------------------------------------
ALTER TABLE platform.tenants
    ADD COLUMN IF NOT EXISTS mfa_policy VARCHAR(20) NOT NULL DEFAULT 'OFF';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_mfa_policy') THEN
        ALTER TABLE platform.tenants
            ADD CONSTRAINT ck_tenants_mfa_policy CHECK (mfa_policy IN ('OFF', 'ADMINS', 'EVERYONE'));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Workspace data exports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.workspace_data_exports (
    id                 UUID PRIMARY KEY,
    tenant_id          UUID         NOT NULL,
    requested_by       UUID         NOT NULL,
    requested_by_email VARCHAR(255),
    status             VARCHAR(20)  NOT NULL DEFAULT 'QUEUED',
    storage            VARCHAR(10),
    file_key           TEXT,
    file_bytes         BYTEA,
    file_name          VARCHAR(200),
    size_bytes         BIGINT,
    table_count        INTEGER,
    row_count          BIGINT,
    error              TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    downloaded_at      TIMESTAMPTZ,
    download_count     INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT ck_wde_status  CHECK (status IN ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED')),
    CONSTRAINT ck_wde_storage CHECK (storage IS NULL OR storage IN ('R2', 'DB'))
);
CREATE INDEX IF NOT EXISTS idx_wde_tenant_created
    ON platform.workspace_data_exports (tenant_id, created_at DESC);

ALTER TABLE platform.workspace_data_exports ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'platform' AND tablename = 'workspace_data_exports'
                      AND policyname = 'tenant_isolation_wde') THEN
        CREATE POLICY tenant_isolation_wde ON platform.workspace_data_exports
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Workspace reset / delete requests (7-day cooling-off, never immediate)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.workspace_lifecycle_requests (
    id                 UUID PRIMARY KEY,
    tenant_id          UUID         NOT NULL,
    kind               VARCHAR(10)  NOT NULL,
    status             VARCHAR(12)  NOT NULL DEFAULT 'SCHEDULED',
    requested_by       UUID         NOT NULL,
    requested_by_email VARCHAR(255),
    confirm_name       VARCHAR(150) NOT NULL,
    reason             TEXT,
    scheduled_for      TIMESTAMPTZ  NOT NULL,
    cancelled_by       UUID,
    cancelled_by_email VARCHAR(255),
    cancelled_at       TIMESTAMPTZ,
    due_notified_at    TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_wlr_kind   CHECK (kind IN ('RESET', 'DELETE')),
    CONSTRAINT ck_wlr_status CHECK (status IN ('SCHEDULED', 'CANCELLED', 'DUE', 'COMPLETED'))
);
-- At most one open request of each kind per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wlr_open_kind
    ON platform.workspace_lifecycle_requests (tenant_id, kind)
    WHERE status IN ('SCHEDULED', 'DUE');
CREATE INDEX IF NOT EXISTS idx_wlr_tenant_created
    ON platform.workspace_lifecycle_requests (tenant_id, created_at DESC);

ALTER TABLE platform.workspace_lifecycle_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'platform' AND tablename = 'workspace_lifecycle_requests'
                      AND policyname = 'tenant_isolation_wlr') THEN
        CREATE POLICY tenant_isolation_wlr ON platform.workspace_lifecycle_requests
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA auth TO ut_app;
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mfa_recovery_codes TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workspace_data_exports TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workspace_lifecycle_requests TO ut_app;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('workspace.profile.update', 'Edit the workspace profile', 'workspace',
     'Change the workspace name, contact email and phone, registered address, GSTIN and PAN. These appear on documents and emails the workspace sends.'),
    ('workspace.security.manage', 'Manage workspace sign-in security', 'workspace',
     'Decide who must use two-factor sign-in, see who has it on, and turn it off for someone who lost their phone. Turning the requirement on changes how people sign in.'),
    ('workspace.data.export', 'Export all workspace data', 'workspace',
     'Download a full copy of the workspace data (a zip of spreadsheets per module, including salaries and personal details). Give this only to people who may take all data out.'),
    ('workspace.lifecycle.manage', 'Request a workspace reset or deletion', 'workspace',
     'Schedule a reset (clear all records) or permanent deletion of the workspace, and cancel such a request. Only a workspace owner can schedule one; there is always a 7-day wait and every owner and admin is emailed.')
ON CONFLICT (code) DO NOTHING;

-- Profile and sign-in security: owners, super admins and admins.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('workspace.profile.update'), ('workspace.security.manage')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN')
ON CONFLICT DO NOTHING;

-- Export and reset/delete: owners and super admins only (the reset/delete
-- request itself also checks the caller holds the OWNER role).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('workspace.data.export'), ('workspace.lifecycle.manage')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
