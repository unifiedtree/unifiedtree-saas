-- ============================================================================
-- V069 - fnf_mgmt schema (settlements, components) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Full & Final settlement on employee exit: HR processes the leaver's settlement
-- (earnings − deductions), Finance/HR approve it, and it is then marked paid.
-- Tenant isolation via RLS using current_tenant_id() (the SET LOCAL app.tenant_id
-- GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS fnf_mgmt;

-- ── fnf_settlements ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fnf_mgmt.fnf_settlements (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    employee_id       UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    last_working_day  DATE          NOT NULL,
    status            VARCHAR(30)   NOT NULL DEFAULT 'INITIATED',
    gross_payable     NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions  NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_settlement    NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes             TEXT,
    processed_at      TIMESTAMPTZ,
    approved_at       TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    approver_id       UUID,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fnf_settlements_employee ON fnf_mgmt.fnf_settlements (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_fnf_settlements_status   ON fnf_mgmt.fnf_settlements (tenant_id, status);

ALTER TABLE fnf_mgmt.fnf_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fnf_settlements ON fnf_mgmt.fnf_settlements;
CREATE POLICY tenant_isolation_fnf_settlements ON fnf_mgmt.fnf_settlements
    USING (tenant_id = current_tenant_id());

-- ── fnf_components ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fnf_mgmt.fnf_components (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    settlement_id UUID          NOT NULL REFERENCES fnf_mgmt.fnf_settlements(id) ON DELETE CASCADE,
    label         VARCHAR(200)  NOT NULL,
    type          VARCHAR(20)   NOT NULL,
    amount        NUMERIC(15,2) NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fnf_components_settlement ON fnf_mgmt.fnf_components (tenant_id, settlement_id);

ALTER TABLE fnf_mgmt.fnf_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fnf_components ON fnf_mgmt.fnf_components;
CREATE POLICY tenant_isolation_fnf_components ON fnf_mgmt.fnf_components
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA fnf_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fnf_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA fnf_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fnf_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.fnf.read',    'View full & final settlements',    'fnf'),
    ('hrms.fnf.process', 'Process full & final settlements', 'fnf'),
    ('hrms.fnf.approve', 'Approve & pay full & final settlements', 'fnf')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + process + approve.
-- FINANCE_LEAD (...0003): read + approve.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.fnf.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.fnf.process'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.fnf.approve'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.fnf.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.fnf.process'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.fnf.approve'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.fnf.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.fnf.process'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.fnf.approve'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.fnf.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.fnf.approve')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.fnf.%';
    RAISE NOTICE 'FnF permission grants: % (expect 11)', cnt;
END $$;
