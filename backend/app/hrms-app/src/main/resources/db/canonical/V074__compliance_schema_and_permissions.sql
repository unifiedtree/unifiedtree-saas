-- ============================================================================
-- V074 - compliance_mgmt schema (items, statutory filings, POSH) + RBAC perms
-- ----------------------------------------------------------------------------
-- Statutory compliance: the compliance calendar (obligations + due dates), the
-- statutory filings ledger (PF / ESI / TDS / PT / Gratuity), and the access-
-- restricted POSH complaints register. Tenant isolation via RLS using
-- current_tenant_id() (the SET LOCAL app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS compliance_mgmt;

-- ── compliance_items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_mgmt.compliance_items (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    company_id  UUID         NOT NULL,
    title       VARCHAR(200) NOT NULL,
    category    VARCHAR(50),
    due_date    DATE         NOT NULL,
    status      VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
    frequency   VARCHAR(30),
    owner_id    UUID,
    notes       TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  VARCHAR(255),
    updated_by  VARCHAR(255),
    version     BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_compliance_items_company ON compliance_mgmt.compliance_items (tenant_id, company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_compliance_items_status  ON compliance_mgmt.compliance_items (tenant_id, status);

ALTER TABLE compliance_mgmt.compliance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_compliance_items ON compliance_mgmt.compliance_items;
CREATE POLICY tenant_isolation_compliance_items ON compliance_mgmt.compliance_items
    USING (tenant_id = current_tenant_id());

-- ── statutory_filings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_mgmt.statutory_filings (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    company_id   UUID          NOT NULL,
    filing_type  VARCHAR(30)   NOT NULL,
    period       VARCHAR(20),
    amount       NUMERIC(15,2),
    due_date     DATE          NOT NULL,
    filed_date   DATE,
    status       VARCHAR(30)   NOT NULL DEFAULT 'DUE',
    reference_no VARCHAR(120),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_statutory_filings_company ON compliance_mgmt.statutory_filings (tenant_id, company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_statutory_filings_status  ON compliance_mgmt.statutory_filings (tenant_id, status);

ALTER TABLE compliance_mgmt.statutory_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_statutory_filings ON compliance_mgmt.statutory_filings;
CREATE POLICY tenant_isolation_statutory_filings ON compliance_mgmt.statutory_filings
    USING (tenant_id = current_tenant_id());

-- ── posh_complaints ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_mgmt.posh_complaints (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    company_id    UUID         NOT NULL,
    complaint_no  VARCHAR(60)  NOT NULL,
    filed_date    DATE         NOT NULL,
    severity      VARCHAR(20),
    status        VARCHAR(30)  NOT NULL DEFAULT 'RECEIVED',
    description   TEXT,
    resolution    TEXT,
    resolved_date DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posh_complaints_company ON compliance_mgmt.posh_complaints (tenant_id, company_id, filed_date);
CREATE INDEX IF NOT EXISTS idx_posh_complaints_status  ON compliance_mgmt.posh_complaints (tenant_id, status);

ALTER TABLE compliance_mgmt.posh_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_posh_complaints ON compliance_mgmt.posh_complaints;
CREATE POLICY tenant_isolation_posh_complaints ON compliance_mgmt.posh_complaints
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA compliance_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA compliance_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA compliance_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA compliance_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.compliance.read',  'View compliance calendar & filings', 'compliance'),
    ('hrms.compliance.write', 'Manage compliance items & filings',  'compliance'),
    ('hrms.compliance.posh',  'Access POSH complaints register',    'compliance')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset (read + write + POSH).
-- HR_MANAGER (...0002): read + write + POSH (sensitive register).
-- FINANCE_LEAD (...0003): read + write (filings ledger), no POSH access.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.compliance.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.compliance.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.compliance.posh'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.compliance.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.compliance.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.compliance.posh'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.compliance.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.compliance.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.compliance.posh'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.compliance.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.compliance.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.compliance.%';
    RAISE NOTICE 'Compliance permission grants: % (expect 11)', cnt;
END $$;
