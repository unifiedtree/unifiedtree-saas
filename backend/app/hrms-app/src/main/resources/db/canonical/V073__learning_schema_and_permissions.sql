-- ============================================================================
-- V073 - learning_mgmt schema (programs, enrollments, skills) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Learning & Development: training program administration, employee self-
-- enrollment, completion tracking, and a per-employee skill / certification
-- matrix. Tenant isolation via RLS using current_tenant_id() (the SET LOCAL
-- app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS learning_mgmt;

-- ── training_programs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_mgmt.training_programs (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    company_id   UUID          NOT NULL,
    title        VARCHAR(200)  NOT NULL,
    description  TEXT,
    category     VARCHAR(50),
    trainer      VARCHAR(150),
    start_date   DATE,
    end_date     DATE,
    capacity     INT,
    status       VARCHAR(30)   NOT NULL DEFAULT 'PLANNED',
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_training_programs_company ON learning_mgmt.training_programs (tenant_id, company_id, status);

ALTER TABLE learning_mgmt.training_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_training_programs ON learning_mgmt.training_programs;
CREATE POLICY tenant_isolation_training_programs ON learning_mgmt.training_programs
    USING (tenant_id = current_tenant_id());

-- ── training_enrollments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_mgmt.training_enrollments (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    program_id   UUID          NOT NULL REFERENCES learning_mgmt.training_programs(id) ON DELETE CASCADE,
    employee_id  UUID          NOT NULL,
    status       VARCHAR(30)   NOT NULL DEFAULT 'ENROLLED',
    completed_at TIMESTAMPTZ,
    score        NUMERIC(5,2),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_program  ON learning_mgmt.training_enrollments (tenant_id, program_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee ON learning_mgmt.training_enrollments (tenant_id, employee_id, status);

ALTER TABLE learning_mgmt.training_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_training_enrollments ON learning_mgmt.training_enrollments;
CREATE POLICY tenant_isolation_training_enrollments ON learning_mgmt.training_enrollments
    USING (tenant_id = current_tenant_id());

-- ── employee_skills ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_mgmt.employee_skills (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    employee_id        UUID          NOT NULL,
    skill_name         VARCHAR(120)  NOT NULL,
    proficiency        INT           NOT NULL DEFAULT 1,
    certified          BOOLEAN       NOT NULL DEFAULT FALSE,
    certification_name VARCHAR(200),
    certified_on       DATE,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON learning_mgmt.employee_skills (tenant_id, employee_id);

ALTER TABLE learning_mgmt.employee_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_employee_skills ON learning_mgmt.employee_skills;
CREATE POLICY tenant_isolation_employee_skills ON learning_mgmt.employee_skills
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by earlier migrations, guarded so
-- this runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA learning_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learning_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA learning_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learning_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.learning.read',        'View learning programs and skills', 'learning'),
    ('hrms.learning.write',       'Manage learning programs and skills', 'learning'),
    ('hrms.learning.enroll.self', 'Enroll in training and view own learning', 'learning')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + write + self-enroll.
-- DEPT_MANAGER (...0005): read + self-enroll.
-- EMPLOYEE (...0004): read + self-enroll.
-- FINANCE_LEAD (...0003): self-enroll.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.learning.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.learning.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.learning.enroll.self'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.learning.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.learning.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.learning.enroll.self'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.learning.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.learning.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.learning.enroll.self'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.learning.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.learning.enroll.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.learning.read'),
    ('00000000-0000-0000-0000-000000000004', 'hrms.learning.enroll.self'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.learning.enroll.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.learning.%';
    RAISE NOTICE 'Learning permission grants: % (expect 14)', cnt;
END $$;
