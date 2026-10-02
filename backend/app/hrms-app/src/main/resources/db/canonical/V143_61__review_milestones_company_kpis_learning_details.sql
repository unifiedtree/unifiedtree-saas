-- V143.61: review cycle dates and sharing, company KPIs, program locations and
-- the certification name on a skill proposal (HRMS redesign, package P-GROW:
-- BW-78, BW-83, BW-85).
--
-- 1. performance_mgmt.review_cycle_milestones: one row per review cycle with the
--    dates of its steps (goals set by, self-reviews by, manager reviews by,
--    shared on) and "hold feedback until shared" (OFF by default). While the
--    hold is on and the cycle isn't shared yet, an employee's My reviews leaves
--    out SUBMITTED reviews other people wrote about them; Share (an admin with
--    hrms.performance.write) records shared_at and shows them. A cycle with no
--    row behaves exactly as before (no dates, no hold).
--    performance_mgmt.review_cycles is mapped by the ReviewCycle entity, so the
--    dates live in this side table instead of new columns.
-- 2. performance_mgmt.company_kpis: company-level KPIs (title, target, unit,
--    due date, status), and performance_mgmt.goal_kpi_links: which goal counts
--    towards which company KPI (performance_mgmt.goals is mapped by the Goal
--    entity, so the link is a side table). A company KPI's progress is the
--    weighted average progress of its linked goals, worked out when read.
-- 3. learning_mgmt.program_locations: where a classroom or on-site program
--    happens (learning_mgmt.training_programs is mapped by the TrainingProgram
--    entity, so the place lives in this side table).
-- 4. learning_mgmt.skill_assessments.certification_name: the certification an
--    employee names when proposing a skill level. skill_assessments is a JDBC
--    table (no entity). Approving the proposal writes it to the skill record.
--
-- Read and written with JDBC only; no JPA entity maps any of these, so no
-- entity changes. Until this file is applied the app answers FEATURE_NOT_READY
-- for the writes and leaves the new fields empty on the reads.
-- No new permissions: the endpoints use hrms.performance.read/.write,
-- hrms.performance.review.self, hrms.kpi.manage, hrms.learning.read/.write and
-- hrms.learning.skill.assess.self, which already exist.
--
-- Numbered 143.61 (assigned slot). Idempotent (IF NOT EXISTS, guarded DO
-- blocks). Production has Flyway OFF: apply by hand, as a superuser (row-level
-- security, grants).

-- ── 1. review cycle dates and sharing ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_mgmt.review_cycle_milestones (
    tenant_id          UUID          NOT NULL,
    cycle_id           UUID          NOT NULL REFERENCES performance_mgmt.review_cycles(id) ON DELETE CASCADE,
    goals_by           DATE,
    self_review_by     DATE,
    manager_review_by  DATE,
    share_on           DATE,
    hold_until_shared  BOOLEAN       NOT NULL DEFAULT FALSE,
    shared_at          TIMESTAMPTZ,
    shared_by          UUID,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by         UUID,
    CONSTRAINT pk_review_cycle_milestones PRIMARY KEY (tenant_id, cycle_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_cycle_milestones_cycle
    ON performance_mgmt.review_cycle_milestones (cycle_id);

COMMENT ON TABLE performance_mgmt.review_cycle_milestones IS
    'The dates of a review cycle''s steps and "hold feedback until shared" (off by default), with when it was shared (V143.61).';

ALTER TABLE performance_mgmt.review_cycle_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_mgmt.review_cycle_milestones FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'performance_mgmt' AND tablename = 'review_cycle_milestones'
                      AND policyname = 'tenant_isolation_review_cycle_milestones') THEN
        CREATE POLICY tenant_isolation_review_cycle_milestones ON performance_mgmt.review_cycle_milestones
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. company KPIs and the goals linked to them ────────────────────────────
CREATE TABLE IF NOT EXISTS performance_mgmt.company_kpis (
    tenant_id     UUID          NOT NULL,
    id            UUID          NOT NULL DEFAULT gen_random_uuid(),
    company_id    UUID          NOT NULL,
    title         VARCHAR(200)  NOT NULL,
    description   VARCHAR(1000),
    target_value  NUMERIC(20,4),
    unit          VARCHAR(24),
    due_date      DATE,
    status        VARCHAR(16)   NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by    UUID,
    CONSTRAINT pk_company_kpis PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_company_kpis_id UNIQUE (id),
    CONSTRAINT ck_company_kpis_status CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED'))
);
CREATE INDEX IF NOT EXISTS idx_company_kpis_company
    ON performance_mgmt.company_kpis (tenant_id, company_id, status);

COMMENT ON TABLE performance_mgmt.company_kpis IS
    'Company-level KPIs that people''s goals count towards; progress is the weighted average of the linked goals (V143.61).';

CREATE TABLE IF NOT EXISTS performance_mgmt.goal_kpi_links (
    tenant_id       UUID          NOT NULL,
    goal_id         UUID          NOT NULL REFERENCES performance_mgmt.goals(id) ON DELETE CASCADE,
    company_kpi_id  UUID          NOT NULL REFERENCES performance_mgmt.company_kpis(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    CONSTRAINT pk_goal_kpi_links PRIMARY KEY (tenant_id, goal_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_kpi_links_kpi
    ON performance_mgmt.goal_kpi_links (tenant_id, company_kpi_id);

COMMENT ON TABLE performance_mgmt.goal_kpi_links IS
    'Which company KPI a goal counts towards (one per goal) (V143.61).';

ALTER TABLE performance_mgmt.company_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_mgmt.company_kpis FORCE ROW LEVEL SECURITY;
ALTER TABLE performance_mgmt.goal_kpi_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_mgmt.goal_kpi_links FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'performance_mgmt' AND tablename = 'company_kpis'
                      AND policyname = 'tenant_isolation_company_kpis') THEN
        CREATE POLICY tenant_isolation_company_kpis ON performance_mgmt.company_kpis
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'performance_mgmt' AND tablename = 'goal_kpi_links'
                      AND policyname = 'tenant_isolation_goal_kpi_links') THEN
        CREATE POLICY tenant_isolation_goal_kpi_links ON performance_mgmt.goal_kpi_links
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. where a program happens ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_mgmt.program_locations (
    tenant_id   UUID          NOT NULL,
    program_id  UUID          NOT NULL REFERENCES learning_mgmt.training_programs(id) ON DELETE CASCADE,
    location    VARCHAR(150)  NOT NULL,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by  UUID,
    CONSTRAINT pk_program_locations PRIMARY KEY (tenant_id, program_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_locations_program
    ON learning_mgmt.program_locations (program_id);

COMMENT ON TABLE learning_mgmt.program_locations IS
    'Where a classroom or on-site training program happens, for example "Bengaluru office" (V143.61).';

ALTER TABLE learning_mgmt.program_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_mgmt.program_locations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'learning_mgmt' AND tablename = 'program_locations'
                      AND policyname = 'tenant_isolation_program_locations') THEN
        CREATE POLICY tenant_isolation_program_locations ON learning_mgmt.program_locations
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. the certification named on a skill proposal ──────────────────────────
ALTER TABLE learning_mgmt.skill_assessments
    ADD COLUMN IF NOT EXISTS certification_name VARCHAR(200);
COMMENT ON COLUMN learning_mgmt.skill_assessments.certification_name IS
    'The certification the employee named with the proposal; written to the skill record when approved (V143.61).';

-- ── grants ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA performance_mgmt TO ut_app;
        GRANT USAGE ON SCHEMA learning_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON performance_mgmt.review_cycle_milestones TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON performance_mgmt.company_kpis TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON performance_mgmt.goal_kpi_links TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON learning_mgmt.program_locations TO ut_app;
    ELSE
        RAISE NOTICE 'V143.61: role ut_app not present — grants skipped';
    END IF;
END $$;
