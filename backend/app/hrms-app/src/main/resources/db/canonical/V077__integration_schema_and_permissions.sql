-- ============================================================================
-- V077 - integration_mgmt schema (integration connections) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Integrations directory: register third-party connections, browse them, toggle
-- their connected state, and remove them. Tenant isolation via RLS using
-- current_tenant_id() (the SET LOCAL app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS integration_mgmt;

-- ── integration_connections ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_mgmt.integration_connections (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    company_id     UUID         NOT NULL,
    name           VARCHAR(150) NOT NULL,
    provider       VARCHAR(80)  NOT NULL,
    category       VARCHAR(50),
    status         VARCHAR(30)  NOT NULL DEFAULT 'DISCONNECTED',
    config_summary TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_integration_connections_company ON integration_mgmt.integration_connections (tenant_id, company_id, status);

ALTER TABLE integration_mgmt.integration_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_integration_connections ON integration_mgmt.integration_connections;
CREATE POLICY tenant_isolation_integration_connections ON integration_mgmt.integration_connections
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by earlier migrations, guarded so
-- this runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA integration_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA integration_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.integration.read',  'View integration connections',   'integration'),
    ('hrms.integration.write', 'Manage integration connections', 'integration')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + write.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.integration.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.integration.write'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.integration.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.integration.write'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.integration.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.integration.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.integration.%';
    RAISE NOTICE 'Integration permission grants: % (expect 6)', cnt;
END $$;
