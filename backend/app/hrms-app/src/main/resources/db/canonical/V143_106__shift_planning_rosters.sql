-- V143.106: shift planning, Phase 1 — rotation patterns, rosters (draft and published) and
-- the published schedule. Design: shift planning + overtime build design, §1.1.
--
-- 1. attendance.rotation_templates / rotation_template_days — a saved rotation pattern
--    ("A A B B C C WO"): N days, each one shift or a weekly off. Company-wide, or one
--    department's own (department_id set).
-- 2. attendance.rosters — a plan for one company, optionally narrowed to a department or a
--    branch ("Building"), over a month or a date range (at most 62 days). DRAFT until it is
--    first published; lock_version is the optimistic lock for two planners.
-- 3. attendance.roster_members / roster_staffing / roster_cells — the people on a roster
--    (with their staggered start in the pattern), the people needed per designation per
--    shift, and the working copy of the days the planner edits. Attendance never reads
--    the working copy.
-- 4. attendance.schedule_days — the PUBLISHED plan: one row per person per date (the date a
--    shift starts). The primary key is also the "no two rosters plan the same person on
--    the same day" guarantee. schedule_day_history is its append-only audit trail (no
--    UPDATE grant).
-- 5. attendance.roster_settings — one row per company (defaults when absent): the minimum
--    rest between two shifts (warning only, default 8 h) and rosters_drive_attendance,
--    which NOTHING reads in Phase 1 (it is Phase 3's per-company switch, default FALSE).
--
-- Safety. Nine new tables read and written with JDBC only (no JPA entity maps them); no
-- column is added to or changed on an existing table, and employee_shift_assignments is
-- never written. Nothing in attendance, late marks, overtime, payroll or leave reads these
-- tables in Phase 1, so every number stays as it is today, for every company. No
-- permission here (V143.107 adds them). Until this file is applied the planner endpoints
-- answer FEATURE_NOT_READY and the planner tab says shift planning isn't switched on yet.
--
-- Numbered 143.106 (reserved for shift planning: 143.106-143.129). Idempotent (IF NOT
-- EXISTS, guarded DO blocks). Production has Flyway OFF: apply by hand, as the table owner
-- (a superuser: row-level security and grants).

-- ── 1. rotation patterns ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.rotation_templates (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    company_id          UUID          NOT NULL,
    department_id       UUID,
    name                VARCHAR(80)   NOT NULL,
    repeats             BOOLEAN       NOT NULL DEFAULT TRUE,
    cycle_length        SMALLINT      NOT NULL,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by_user_id  UUID,
    created_by_name     VARCHAR(200),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by_user_id  UUID,
    updated_by_name     VARCHAR(200),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_rotation_templates_cycle CHECK (cycle_length BETWEEN 1 AND 62)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rotation_templates_name
    ON attendance.rotation_templates (tenant_id, company_id, lower(name)) WHERE is_active;

COMMENT ON TABLE attendance.rotation_templates IS
    'Saved rotation patterns for the shift planner; department_id NULL = company-wide; is_active FALSE = deleted (V143.106). JDBC only.';

CREATE TABLE IF NOT EXISTS attendance.rotation_template_days (
    tenant_id        UUID       NOT NULL,
    template_id      UUID       NOT NULL REFERENCES attendance.rotation_templates (id) ON DELETE CASCADE,
    day_no           SMALLINT   NOT NULL,
    shift_policy_id  UUID       REFERENCES attendance.shift_policies (id),
    weekly_off       BOOLEAN    NOT NULL DEFAULT FALSE,
    PRIMARY KEY (template_id, day_no),
    CONSTRAINT ck_rotation_template_days_day_no CHECK (day_no BETWEEN 1 AND 62),
    CONSTRAINT ck_rotation_template_days_one CHECK ((shift_policy_id IS NULL) = weekly_off)
);

COMMENT ON TABLE attendance.rotation_template_days IS
    'The days of a rotation pattern: each day is exactly one shift or a weekly off (V143.106). JDBC only.';

-- ── 2. rosters ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.rosters (
    id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID          NOT NULL,
    company_id                UUID          NOT NULL,
    department_id             UUID,
    branch_id                 UUID,
    name                      VARCHAR(120)  NOT NULL,
    period_type               VARCHAR(8)    NOT NULL,
    start_date                DATE          NOT NULL,
    end_date                  DATE          NOT NULL,
    status                    VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
    source                    VARCHAR(8)    NOT NULL DEFAULT 'PLANNER',
    template_id               UUID,
    config                    JSONB         NOT NULL DEFAULT '{}',
    has_unpublished_changes   BOOLEAN       NOT NULL DEFAULT FALSE,
    version                   INT           NOT NULL DEFAULT 0,
    lock_version              INT           NOT NULL DEFAULT 0,
    published_by_user_id      UUID,
    published_by_name         VARCHAR(200),
    published_at              TIMESTAMPTZ,
    first_published_at        TIMESTAMPTZ,
    created_by_user_id        UUID,
    created_by_name           VARCHAR(200),
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by_user_id        UUID,
    updated_by_name           VARCHAR(200),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_rosters_period_type CHECK (period_type IN ('MONTH', 'RANGE')),
    CONSTRAINT ck_rosters_dates CHECK (end_date >= start_date AND end_date - start_date <= 61),
    CONSTRAINT ck_rosters_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
    CONSTRAINT ck_rosters_source CHECK (source IN ('PLANNER', 'IMPORT'))
);
CREATE INDEX IF NOT EXISTS idx_rosters_company_start
    ON attendance.rosters (tenant_id, company_id, start_date);

COMMENT ON TABLE attendance.rosters IS
    'Shift roster headers: company, optional department/branch, period, DRAFT/PUBLISHED, publish count and optimistic lock (V143.106). JDBC only.';

CREATE TABLE IF NOT EXISTS attendance.roster_members (
    tenant_id        UUID       NOT NULL,
    roster_id        UUID       NOT NULL REFERENCES attendance.rosters (id) ON DELETE CASCADE,
    employee_id      UUID       NOT NULL,
    sort_order       INT        NOT NULL DEFAULT 0,
    rotation_offset  SMALLINT   NOT NULL DEFAULT 0,
    PRIMARY KEY (roster_id, employee_id),
    CONSTRAINT ck_roster_members_offset CHECK (rotation_offset BETWEEN 0 AND 61)
);
CREATE INDEX IF NOT EXISTS idx_roster_members_employee
    ON attendance.roster_members (tenant_id, employee_id);

COMMENT ON TABLE attendance.roster_members IS
    'People on a roster, in display order, with their staggered start day in the pattern (V143.106). JDBC only.';

CREATE TABLE IF NOT EXISTS attendance.roster_staffing (
    tenant_id        UUID       NOT NULL,
    roster_id        UUID       NOT NULL REFERENCES attendance.rosters (id) ON DELETE CASCADE,
    designation_id   UUID       NOT NULL,
    shift_policy_id  UUID       NOT NULL,
    required         SMALLINT   NOT NULL,
    PRIMARY KEY (roster_id, designation_id, shift_policy_id),
    CONSTRAINT ck_roster_staffing_required CHECK (required BETWEEN 0 AND 999)
);

COMMENT ON TABLE attendance.roster_staffing IS
    'People needed per designation per shift on every day of a roster''s period (V143.106). JDBC only.';

CREATE TABLE IF NOT EXISTS attendance.roster_cells (
    tenant_id        UUID         NOT NULL,
    roster_id        UUID         NOT NULL REFERENCES attendance.rosters (id) ON DELETE CASCADE,
    employee_id      UUID         NOT NULL,
    work_date        DATE         NOT NULL,
    kind             VARCHAR(5)   NOT NULL,
    shift_policy_id  UUID,
    edited           BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (roster_id, employee_id, work_date),
    CONSTRAINT ck_roster_cells_kind CHECK (kind IN ('SHIFT', 'WO')),
    CONSTRAINT ck_roster_cells_shift CHECK ((kind = 'SHIFT') = (shift_policy_id IS NOT NULL))
);

COMMENT ON TABLE attendance.roster_cells IS
    'The planner''s working copy of a roster: one row per non-empty (person, date); never read by attendance (V143.106). JDBC only.';

-- ── 3. the published schedule ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.schedule_days (
    tenant_id           UUID          NOT NULL,
    employee_id         UUID          NOT NULL,
    work_date           DATE          NOT NULL,
    company_id          UUID          NOT NULL,
    kind                VARCHAR(5)    NOT NULL,
    shift_policy_id     UUID,
    roster_id           UUID          NOT NULL,
    roster_version      INT           NOT NULL,
    source              VARCHAR(12)   NOT NULL,
    source_ref_id       UUID,
    updated_by_user_id  UUID,
    updated_by_name     VARCHAR(200),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, employee_id, work_date),
    CONSTRAINT ck_schedule_days_kind CHECK (kind IN ('SHIFT', 'WO')),
    CONSTRAINT ck_schedule_days_shift CHECK ((kind = 'SHIFT') = (shift_policy_id IS NOT NULL)),
    CONSTRAINT ck_schedule_days_source CHECK (source IN ('ROSTER', 'IMPORT', 'SWAP', 'SHIFT_CHANGE'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_days_company_date
    ON attendance.schedule_days (tenant_id, company_id, work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_days_roster
    ON attendance.schedule_days (tenant_id, roster_id);

COMMENT ON TABLE attendance.schedule_days IS
    'The published shift schedule: one row per person per date (the date the shift starts). Read by nothing in attendance until Phase 3 (V143.106). JDBC only.';

CREATE TABLE IF NOT EXISTS attendance.schedule_day_history (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    employee_id          UUID          NOT NULL,
    work_date            DATE          NOT NULL,
    roster_id            UUID          NOT NULL,
    roster_version       INT           NOT NULL,
    change_kind          VARCHAR(8)    NOT NULL,
    old_kind             VARCHAR(5),
    new_kind             VARCHAR(5),
    old_shift_policy_id  UUID,
    new_shift_policy_id  UUID,
    source               VARCHAR(12)   NOT NULL,
    source_ref_id        UUID,
    changed_by_user_id   UUID,
    changed_by_name      VARCHAR(200),
    changed_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    note                 VARCHAR(500),
    CONSTRAINT ck_schedule_day_history_change CHECK (change_kind IN ('ADDED', 'CHANGED', 'REMOVED')),
    CONSTRAINT ck_schedule_day_history_source CHECK (source IN ('ROSTER', 'IMPORT', 'SWAP', 'SHIFT_CHANGE'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_day_history_emp_date
    ON attendance.schedule_day_history (tenant_id, employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_day_history_roster
    ON attendance.schedule_day_history (tenant_id, roster_id, changed_at);

COMMENT ON TABLE attendance.schedule_day_history IS
    'Append-only audit of every published schedule change: publish, and later swaps and shift changes (V143.106). JDBC only.';

-- ── 4. per-company roster settings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.roster_settings (
    tenant_id                  UUID          NOT NULL,
    company_id                 UUID          NOT NULL,
    min_rest_minutes           SMALLINT      NOT NULL DEFAULT 480,
    rosters_drive_attendance   BOOLEAN       NOT NULL DEFAULT FALSE,
    updated_by_user_id         UUID,
    updated_by_name            VARCHAR(200),
    updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, company_id),
    CONSTRAINT ck_roster_settings_min_rest CHECK (min_rest_minutes BETWEEN 0 AND 1440)
);

COMMENT ON TABLE attendance.roster_settings IS
    'Shift planner settings per company (defaults when absent). rosters_drive_attendance is read by nothing until Phase 3 (V143.106). JDBC only.';

-- ── 5. row-level security (one tenant sees only its own rows) ────────────────
ALTER TABLE attendance.rotation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.rotation_templates FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'rotation_templates'
                      AND policyname = 'tenant_isolation_rotation_templates') THEN
        CREATE POLICY tenant_isolation_rotation_templates ON attendance.rotation_templates
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.rotation_template_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.rotation_template_days FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'rotation_template_days'
                      AND policyname = 'tenant_isolation_rotation_template_days') THEN
        CREATE POLICY tenant_isolation_rotation_template_days ON attendance.rotation_template_days
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.rosters FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'rosters'
                      AND policyname = 'tenant_isolation_rosters') THEN
        CREATE POLICY tenant_isolation_rosters ON attendance.rosters
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.roster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.roster_members FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'roster_members'
                      AND policyname = 'tenant_isolation_roster_members') THEN
        CREATE POLICY tenant_isolation_roster_members ON attendance.roster_members
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.roster_staffing ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.roster_staffing FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'roster_staffing'
                      AND policyname = 'tenant_isolation_roster_staffing') THEN
        CREATE POLICY tenant_isolation_roster_staffing ON attendance.roster_staffing
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.roster_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.roster_cells FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'roster_cells'
                      AND policyname = 'tenant_isolation_roster_cells') THEN
        CREATE POLICY tenant_isolation_roster_cells ON attendance.roster_cells
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.schedule_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.schedule_days FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'schedule_days'
                      AND policyname = 'tenant_isolation_schedule_days') THEN
        CREATE POLICY tenant_isolation_schedule_days ON attendance.schedule_days
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.schedule_day_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.schedule_day_history FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'schedule_day_history'
                      AND policyname = 'tenant_isolation_schedule_day_history') THEN
        CREATE POLICY tenant_isolation_schedule_day_history ON attendance.schedule_day_history
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE attendance.roster_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.roster_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'roster_settings'
                      AND policyname = 'tenant_isolation_roster_settings') THEN
        CREATE POLICY tenant_isolation_roster_settings ON attendance.roster_settings
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 6. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.rotation_templates     TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.rotation_template_days TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.rosters                TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.roster_members         TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.roster_staffing        TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.roster_cells           TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.schedule_days          TO ut_app;
        -- History is append-only: no UPDATE.
        GRANT SELECT, INSERT, DELETE         ON attendance.schedule_day_history   TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.roster_settings        TO ut_app;
    ELSE
        RAISE NOTICE 'V143.106: role ut_app not present — grants skipped';
    END IF;
END $$;
