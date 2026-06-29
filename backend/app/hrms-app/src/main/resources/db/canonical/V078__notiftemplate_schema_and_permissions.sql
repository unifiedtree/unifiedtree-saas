-- ============================================================================
-- V078 - notiftemplate_mgmt schema (notification_templates) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Per-company notification message templates keyed by delivery channel and a
-- domain event. HR administrators author the subject/body rendered when an
-- event fires. Tenant isolation via RLS using current_tenant_id() (the SET
-- LOCAL app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS notiftemplate_mgmt;

-- ── notification_templates ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notiftemplate_mgmt.notification_templates (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID          NOT NULL,
    company_id  UUID          NOT NULL,
    name        VARCHAR(150)  NOT NULL,
    channel     VARCHAR(20)   NOT NULL,
    event_key   VARCHAR(80)   NOT NULL,
    subject     VARCHAR(300),
    body        TEXT,
    active      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  VARCHAR(255),
    updated_by  VARCHAR(255),
    version     BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notification_templates_company
    ON notiftemplate_mgmt.notification_templates (tenant_id, company_id, active);
CREATE INDEX IF NOT EXISTS idx_notification_templates_event
    ON notiftemplate_mgmt.notification_templates (tenant_id, event_key, channel);

ALTER TABLE notiftemplate_mgmt.notification_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_templates ON notiftemplate_mgmt.notification_templates;
CREATE POLICY tenant_isolation_notification_templates ON notiftemplate_mgmt.notification_templates
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by earlier migrations, guarded so
-- this runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA notiftemplate_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notiftemplate_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA notiftemplate_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notiftemplate_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.notiftemplate.read',  'View notification templates',   'notiftemplate'),
    ('hrms.notiftemplate.write', 'Manage notification templates', 'notiftemplate')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + write.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.notiftemplate.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.notiftemplate.write'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.notiftemplate.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.notiftemplate.write'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.notiftemplate.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.notiftemplate.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.notiftemplate.%';
    RAISE NOTICE 'Notification template permission grants: % (expect 6)', cnt;
END $$;
