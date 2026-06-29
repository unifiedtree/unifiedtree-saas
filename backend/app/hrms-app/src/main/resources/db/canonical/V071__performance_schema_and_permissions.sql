-- ============================================================================
-- V071 - performance_mgmt schema (cycles, reviews, goals) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Performance management: review cycle administration, manager-authored
-- performance reviews, and employee self-service goals with progress tracking.
-- Tenant isolation via RLS using current_tenant_id() (the SET LOCAL
-- app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS performance_mgmt;

-- ── review_cycles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_mgmt.review_cycles (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL,
    company_id   UUID         NOT NULL,
    name         VARCHAR(150) NOT NULL,
    period_start DATE,
    period_end   DATE,
    status       VARCHAR(30)  NOT NULL DEFAULT 'DRAFT',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),
    version      BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_review_cycles_company ON performance_mgmt.review_cycles (tenant_id, company_id, status);

ALTER TABLE performance_mgmt.review_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_review_cycles ON performance_mgmt.review_cycles;
CREATE POLICY tenant_isolation_review_cycles ON performance_mgmt.review_cycles
    USING (tenant_id = current_tenant_id());

-- ── performance_reviews ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_mgmt.performance_reviews (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    cycle_id       UUID         NOT NULL,
    employee_id    UUID         NOT NULL,
    reviewer_id    UUID,
    status         VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
    overall_rating NUMERIC(3,1),
    strengths      TEXT,
    improvements   TEXT,
    submitted_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_cycle    ON performance_mgmt.performance_reviews (tenant_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_mgmt.performance_reviews (tenant_id, employee_id, status);

ALTER TABLE performance_mgmt.performance_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_performance_reviews ON performance_mgmt.performance_reviews;
CREATE POLICY tenant_isolation_performance_reviews ON performance_mgmt.performance_reviews
    USING (tenant_id = current_tenant_id());

-- ── goals ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_mgmt.goals (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    employee_id UUID         NOT NULL,
    cycle_id    UUID,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    weight      INT          NOT NULL DEFAULT 0,
    progress    INT          NOT NULL DEFAULT 0,
    status      VARCHAR(30)  NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  VARCHAR(255),
    updated_by  VARCHAR(255),
    version     BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goals_employee ON performance_mgmt.goals (tenant_id, employee_id, status);

ALTER TABLE performance_mgmt.goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_goals ON performance_mgmt.goals;
CREATE POLICY tenant_isolation_goals ON performance_mgmt.goals
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA performance_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA performance_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA performance_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA performance_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.performance.read',        'View performance data',        'performance'),
    ('hrms.performance.write',       'Manage review cycles/reviews', 'performance'),
    ('hrms.performance.review.self', 'Manage own reviews and goals', 'performance')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): read + write + own reviews/goals.
-- DEPT_MANAGER (...0005): read + own reviews/goals.
-- FINANCE_LEAD (...0003): own reviews/goals.
-- EMPLOYEE (...0004): own reviews/goals.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.performance.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.performance.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.performance.review.self'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.performance.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.performance.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.performance.review.self'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.performance.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.performance.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.performance.review.self'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.performance.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.performance.review.self'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.performance.review.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.performance.review.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.performance.%';
    RAISE NOTICE 'Performance permission grants: % (expect 13)', cnt;
END $$;
