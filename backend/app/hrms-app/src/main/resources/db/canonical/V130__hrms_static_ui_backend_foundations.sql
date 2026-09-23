-- ============================================================================
-- V130 - HRMS static UI backend foundations
-- ============================================================================

CREATE TABLE IF NOT EXISTS pli_mgmt.pli_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    owner_type VARCHAR(40) NOT NULL DEFAULT 'COMPANY',
    owner_id UUID,
    period VARCHAR(30) NOT NULL,
    metric VARCHAR(80) NOT NULL,
    target_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    actual_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    weight_percent NUMERIC(5,2) NOT NULL DEFAULT 100,
    payout_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pli_targets_company_period ON pli_mgmt.pli_targets (tenant_id, company_id, period, status);
ALTER TABLE pli_mgmt.pli_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pli_targets ON pli_mgmt.pli_targets;
CREATE POLICY tenant_isolation_pli_targets ON pli_mgmt.pli_targets USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS hiring_mgmt.offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    requisition_id UUID REFERENCES hiring_mgmt.job_requisitions(id) ON DELETE SET NULL,
    candidate_id UUID REFERENCES hiring_mgmt.candidates(id) ON DELETE SET NULL,
    company_id UUID NOT NULL,
    candidate_name VARCHAR(200) NOT NULL,
    role_title VARCHAR(200) NOT NULL,
    offered_ctc NUMERIC(15,2) NOT NULL DEFAULT 0,
    joining_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    sent_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hiring_offers_company_status ON hiring_mgmt.offers (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_hiring_offers_requisition ON hiring_mgmt.offers (tenant_id, requisition_id);
ALTER TABLE hiring_mgmt.offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_hiring_offers ON hiring_mgmt.offers;
CREATE POLICY tenant_isolation_hiring_offers ON hiring_mgmt.offers USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS hrms.onboarding_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    employee_id UUID,
    onboarding_instance_id UUID REFERENCES hrms.onboarding_instances(id) ON DELETE SET NULL,
    asset_tag VARCHAR(80) NOT NULL,
    asset_type VARCHAR(80) NOT NULL,
    asset_name VARCHAR(200) NOT NULL,
    serial_no VARCHAR(120),
    status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
    assigned_at DATE,
    returned_at DATE,
    condition_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_onboarding_assets_tag UNIQUE (tenant_id, asset_tag)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_assets_company_status ON hrms.onboarding_assets (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_assets_employee ON hrms.onboarding_assets (tenant_id, employee_id);
ALTER TABLE hrms.onboarding_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_onboarding_assets ON hrms.onboarding_assets;
CREATE POLICY tenant_isolation_onboarding_assets ON hrms.onboarding_assets USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS compliance_mgmt.inspector_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    inspector_name VARCHAR(200) NOT NULL,
    inspector_org VARCHAR(200),
    purpose VARCHAR(200) NOT NULL,
    access_code VARCHAR(24) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    expires_at TIMESTAMPTZ NOT NULL,
    last_accessed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inspector_sessions_company_status ON compliance_mgmt.inspector_sessions (tenant_id, company_id, status, expires_at);
ALTER TABLE compliance_mgmt.inspector_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_inspector_sessions ON compliance_mgmt.inspector_sessions;
CREATE POLICY tenant_isolation_inspector_sessions ON compliance_mgmt.inspector_sessions USING (tenant_id = current_tenant_id());

INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.pli.target.read', 'View PLI targets', 'pli'),
    ('hrms.pli.target.write', 'Manage PLI targets', 'pli'),
    ('hrms.hiring.offer.read', 'View hiring offers', 'hiring'),
    ('hrms.hiring.offer.write', 'Manage hiring offers', 'hiring'),
    ('hrms.onboarding.asset.read', 'View onboarding assets', 'onboarding'),
    ('hrms.onboarding.asset.write', 'Manage onboarding assets', 'onboarding'),
    ('hrms.compliance.inspector.read', 'View inspector sessions', 'compliance'),
    ('hrms.compliance.inspector.write', 'Manage inspector sessions', 'compliance')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000001','hrms.pli.target.read'),
    ('00000000-0000-0000-0000-000000000001','hrms.pli.target.write'),
    ('00000000-0000-0000-0000-000000000001','hrms.hiring.offer.read'),
    ('00000000-0000-0000-0000-000000000001','hrms.hiring.offer.write'),
    ('00000000-0000-0000-0000-000000000001','hrms.onboarding.asset.read'),
    ('00000000-0000-0000-0000-000000000001','hrms.onboarding.asset.write'),
    ('00000000-0000-0000-0000-000000000001','hrms.compliance.inspector.read'),
    ('00000000-0000-0000-0000-000000000001','hrms.compliance.inspector.write'),
    ('00000000-0000-0000-0000-000000000010','hrms.pli.target.read'),
    ('00000000-0000-0000-0000-000000000010','hrms.pli.target.write'),
    ('00000000-0000-0000-0000-000000000010','hrms.hiring.offer.read'),
    ('00000000-0000-0000-0000-000000000010','hrms.hiring.offer.write'),
    ('00000000-0000-0000-0000-000000000010','hrms.onboarding.asset.read'),
    ('00000000-0000-0000-0000-000000000010','hrms.onboarding.asset.write'),
    ('00000000-0000-0000-0000-000000000010','hrms.compliance.inspector.read'),
    ('00000000-0000-0000-0000-000000000010','hrms.compliance.inspector.write'),
    ('00000000-0000-0000-0000-000000000002','hrms.pli.target.read'),
    ('00000000-0000-0000-0000-000000000002','hrms.pli.target.write'),
    ('00000000-0000-0000-0000-000000000002','hrms.hiring.offer.read'),
    ('00000000-0000-0000-0000-000000000002','hrms.hiring.offer.write'),
    ('00000000-0000-0000-0000-000000000002','hrms.onboarding.asset.read'),
    ('00000000-0000-0000-0000-000000000002','hrms.onboarding.asset.write'),
    ('00000000-0000-0000-0000-000000000002','hrms.compliance.inspector.read'),
    ('00000000-0000-0000-0000-000000000002','hrms.compliance.inspector.write'),
    ('00000000-0000-0000-0000-000000000003','hrms.pli.target.read'),
    ('00000000-0000-0000-0000-000000000003','hrms.pli.target.write'),
    ('00000000-0000-0000-0000-000000000003','hrms.onboarding.asset.read'),
    ('00000000-0000-0000-0000-000000000003','hrms.compliance.inspector.read'),
    ('00000000-0000-0000-0000-000000000005','hrms.hiring.offer.read'),
    ('00000000-0000-0000-0000-000000000005','hrms.onboarding.asset.read')
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON pli_mgmt.pli_targets TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hiring_mgmt.offers TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.onboarding_assets TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_mgmt.inspector_sessions TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON pli_mgmt.pli_targets TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hiring_mgmt.offers TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.onboarding_assets TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_mgmt.inspector_sessions TO app_user;
    END IF;
END $$;
