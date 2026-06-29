-- ============================================================================
-- V076 - pli_mgmt schema (performance-linked incentive awards) + RBAC perms
-- ----------------------------------------------------------------------------
-- Performance-Linked Incentives: HR/Finance propose incentive awards for
-- employees, approve or reject them, and mark approved awards as paid. Tenant
-- isolation via RLS using current_tenant_id() (the SET LOCAL app.tenant_id GUC
-- set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS pli_mgmt;

-- ── pli_awards ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pli_mgmt.pli_awards (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    employee_id  UUID          NOT NULL,
    company_id   UUID          NOT NULL,
    plan_name    VARCHAR(200)  NOT NULL,
    period       VARCHAR(20),
    amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
    rating_basis NUMERIC(3,1),
    status       VARCHAR(30)   NOT NULL DEFAULT 'PROPOSED',
    notes        TEXT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pli_awards_employee ON pli_mgmt.pli_awards (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_pli_awards_status   ON pli_mgmt.pli_awards (tenant_id, status);

ALTER TABLE pli_mgmt.pli_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pli_awards ON pli_mgmt.pli_awards;
CREATE POLICY tenant_isolation_pli_awards ON pli_mgmt.pli_awards
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA pli_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pli_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA pli_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pli_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.pli.read',      'View incentive awards',        'pli'),
    ('hrms.pli.write',     'Manage incentive awards',      'pli'),
    ('hrms.pli.read.self', 'View own incentive awards',    'pli')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + write + own.
-- FINANCE_LEAD (...0003): read + write + own.
-- DEPT_MANAGER (...0005): own only.
-- EMPLOYEE (...0004): own only.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.pli.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.pli.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.pli.read.self'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.pli.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.pli.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.pli.read.self'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.pli.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.pli.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.pli.read.self'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.pli.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.pli.write'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.pli.read.self'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.pli.read.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.pli.read.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.pli.%';
    RAISE NOTICE 'PLI permission grants: % (expect 14)', cnt;
END $$;
