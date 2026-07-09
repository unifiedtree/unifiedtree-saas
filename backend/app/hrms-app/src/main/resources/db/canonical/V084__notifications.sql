-- ============================================================================
-- V084 - notif schema (in-app notifications + Expo push device tokens)
-- ----------------------------------------------------------------------------
-- Adds the notif.notifications table (recipient-scoped feed) and notif.device_tokens
-- (Expo push token per device), both tenant-isolated via RLS on current_tenant_id().
--
-- User-scoping is enforced at the query layer (WHERE user_id = :jwtEmployeeId)
-- inside AppNotificationService, because RLS in this codebase has no
-- current_user_id() GUC yet. RLS remains the DB-side backstop for tenant
-- boundaries; the service is the source of truth for user boundaries.
--
-- Flyway is DISABLED in production (see memory: flyway-must-stay-disabled), so
-- this migration is applied MANUALLY on Railway via scripts/apply-migration.py
-- (psycopg). Written idempotently (IF NOT EXISTS / DROP POLICY IF EXISTS) so a
-- manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS notif;

-- ── notif.notifications ─────────────────────────────────────────────────────
-- One row per recipient per event. `data` carries the deep-link payload
-- (route, refId) that the mobile tap handler follows.
CREATE TABLE IF NOT EXISTS notif.notifications (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID          NOT NULL,
    user_id     UUID          NOT NULL,          -- employees.id (= JWT employee_id/sub)
    type        VARCHAR(60)   NOT NULL,          -- see AppNotificationType enum
    title       VARCHAR(300)  NOT NULL,
    body        TEXT,
    data        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  VARCHAR(255),
    updated_by  VARCHAR(255),
    version     BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user_created
    ON notif.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread
    ON notif.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_tenant
    ON notif.notifications (tenant_id);

ALTER TABLE notif.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notif ON notif.notifications;
CREATE POLICY tenant_isolation_notif ON notif.notifications
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── notif.device_tokens ─────────────────────────────────────────────────────
-- Expo push tokens per (user, device). Uniqueness on (user_id, expo_push_token)
-- so a re-login on the same device is a no-op update, not a duplicate row.
-- When a device changes hands (a new user logs in), the previous user's row
-- with the same token is flipped is_active=false by AppNotificationService.
CREATE TABLE IF NOT EXISTS notif.device_tokens (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL,
    user_id          UUID         NOT NULL,
    expo_push_token  TEXT         NOT NULL,
    platform         VARCHAR(20),           -- 'ios' | 'android' | 'web'
    device_name      VARCHAR(120),
    app_version      VARCHAR(30),
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_tokens_user_token
    ON notif.device_tokens (user_id, expo_push_token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active
    ON notif.device_tokens (user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_device_tokens_token
    ON notif.device_tokens (expo_push_token);

ALTER TABLE notif.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.device_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_device_tokens ON notif.device_tokens;
CREATE POLICY tenant_isolation_device_tokens ON notif.device_tokens
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Grant the runtime app role(s) access to the new schema ──────────────────
-- Mirrors the dual-role pattern (ut_app / hrms_app / app_user) from V078, guarded
-- so this runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA notif TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notif TO ut_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA notif TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notif TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA notif TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notif TO app_user;
    END IF;
END $$;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM information_schema.tables
     WHERE table_schema = 'notif' AND table_name IN ('notifications', 'device_tokens');
    RAISE NOTICE 'notif tables installed: % (expect 2)', cnt;
END $$;
