-- ============================================================================
-- V072 - document_mgmt schema (employee document vault) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Employee document vault: HR/admin stores employee documents (contracts, ID
-- proofs, certificates, payslips, policies, tax) and employees read their own.
-- Tenant isolation via RLS using current_tenant_id() (the SET LOCAL app.tenant_id
-- GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS document_mgmt;

-- ── employee_documents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_mgmt.employee_documents (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID          NOT NULL,
    employee_id UUID          NOT NULL,
    company_id  UUID          NOT NULL,
    title       VARCHAR(300)  NOT NULL,
    category    VARCHAR(50)   NOT NULL DEFAULT 'OTHER',
    file_url    TEXT          NOT NULL,
    issued_date DATE,
    expiry_date DATE,
    notes       TEXT,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  VARCHAR(255),
    updated_by  VARCHAR(255),
    version     BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON document_mgmt.employee_documents (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_documents_company  ON document_mgmt.employee_documents (tenant_id, company_id, category);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry   ON document_mgmt.employee_documents (tenant_id, expiry_date);

ALTER TABLE document_mgmt.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_employee_documents ON document_mgmt.employee_documents;
CREATE POLICY tenant_isolation_employee_documents ON document_mgmt.employee_documents
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA document_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA document_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA document_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA document_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.document.read.self', 'View own documents',       'document'),
    ('hrms.document.read',      'View employee documents',  'document'),
    ('hrms.document.write',     'Manage employee documents','document')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): manage + read + own.
-- DEPT_MANAGER (...0005): read team + own.
-- FINANCE_LEAD (...0003): own only.
-- EMPLOYEE (...0004): own only.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.document.read.self'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.document.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.document.write'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.document.read.self'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.document.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.document.write'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.document.read.self'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.document.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.document.write'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.document.read.self'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.document.read'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.document.read.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.document.read.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.document.%';
    RAISE NOTICE 'Document permission grants: % (expect 13)', cnt;
END $$;
