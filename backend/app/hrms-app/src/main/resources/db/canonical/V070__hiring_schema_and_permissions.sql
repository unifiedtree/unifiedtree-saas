-- ============================================================================
-- V070 - hiring_mgmt schema (job requisitions, candidates) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Recruitment: job requisition management and the candidate hiring pipeline.
-- Tenant isolation via RLS using current_tenant_id() (the SET LOCAL app.tenant_id
-- GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS hiring_mgmt;

-- ── job_requisitions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_mgmt.job_requisitions (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    title             VARCHAR(200)  NOT NULL,
    department_id     UUID,
    openings          INT           NOT NULL DEFAULT 1,
    status            VARCHAR(30)   NOT NULL DEFAULT 'OPEN',
    employment_type   VARCHAR(30),
    location          VARCHAR(150),
    description       TEXT,
    hiring_manager_id UUID,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_job_requisitions_company ON hiring_mgmt.job_requisitions (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_job_requisitions_status  ON hiring_mgmt.job_requisitions (tenant_id, status);

ALTER TABLE hiring_mgmt.job_requisitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_job_requisitions ON hiring_mgmt.job_requisitions;
CREATE POLICY tenant_isolation_job_requisitions ON hiring_mgmt.job_requisitions
    USING (tenant_id = current_tenant_id());

-- ── candidates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_mgmt.candidates (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    requisition_id  UUID          NOT NULL REFERENCES hiring_mgmt.job_requisitions(id) ON DELETE CASCADE,
    full_name       VARCHAR(200)  NOT NULL,
    email           VARCHAR(200),
    phone           VARCHAR(40),
    stage           VARCHAR(30)   NOT NULL DEFAULT 'APPLIED',
    source          VARCHAR(80),
    expected_ctc    NUMERIC(15,2),
    notes           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_candidates_requisition ON hiring_mgmt.candidates (tenant_id, requisition_id, stage);

ALTER TABLE hiring_mgmt.candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_candidates ON hiring_mgmt.candidates;
CREATE POLICY tenant_isolation_candidates ON hiring_mgmt.candidates
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA hiring_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hiring_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA hiring_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hiring_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.hiring.read',            'View job requisitions and candidates', 'hiring'),
    ('hrms.hiring.write',           'Manage job requisitions',             'hiring'),
    ('hrms.hiring.candidate.write', 'Manage candidates',                   'hiring')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + manage requisitions + manage candidates.
-- DEPT_MANAGER (...0005): read + manage candidates for their openings.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.hiring.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.hiring.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.hiring.candidate.write'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.hiring.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.hiring.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.hiring.candidate.write'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.hiring.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.hiring.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.hiring.candidate.write'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.hiring.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.hiring.candidate.write')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.hiring.%';
    RAISE NOTICE 'Hiring permission grants: % (expect 11)', cnt;
END $$;
