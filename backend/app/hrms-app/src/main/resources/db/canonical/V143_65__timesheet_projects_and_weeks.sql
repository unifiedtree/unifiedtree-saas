-- V143.65: the timesheet by project, and "Submit week" to the approver
-- (HRMS redesign, package P-ATT-DAY: BW-36). All additive; nothing that exists
-- today changes meaning.
--
-- 1. hrms.time_entries.project_id — an optional project on a time entry. A
--    description alone still works, as today; with a project the description
--    may be left empty. JDBC only (no entity maps hrms.time_entries).
-- 2. hrms.projects.code — an optional short code shown next to a project's
--    name ("Payments v2 · PAY-V2"). JDBC only (no entity maps hrms.projects).
-- 3. hrms.timesheet_weeks — one row per person and week they submitted:
--    SUBMITTED, then APPROVED or REJECTED by someone holding
--    hrms.timesheet.approve for that person (team-scoped for managers). Entries
--    in a SUBMITTED or APPROVED week are locked; a REJECTED week opens again.
--    Weeks nobody submitted are never locked, as before. JDBC only.
-- 4. The permission hrms.timesheet.approve ("Approve timesheets", module
--    attendance), granted to OWNER, SUPER_ADMIN, HR_MANAGER and DEPT_MANAGER.
--    OWNER must hold it or the app refuses to start
--    (OwnerPermissionInvariantCheck).
--
-- Numbered 143.65 (the redesign's range). Idempotent.
-- Production has Flyway OFF: apply by hand, as a superuser (row-level security).

-- ── 1. a project on a time entry ─────────────────────────────────────────────
ALTER TABLE hrms.time_entries ADD COLUMN IF NOT EXISTS project_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'hrms.time_entries'::regclass AND conname = 'fk_time_entries_project') THEN
        ALTER TABLE hrms.time_entries
            ADD CONSTRAINT fk_time_entries_project FOREIGN KEY (project_id) REFERENCES hrms.projects (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_time_entries_project
    ON hrms.time_entries (tenant_id, project_id) WHERE project_id IS NOT NULL;

COMMENT ON COLUMN hrms.time_entries.project_id IS
    'The project this time was spent on (V143.65); optional. With a project the description may be empty.';

-- ── 2. a project code ────────────────────────────────────────────────────────
ALTER TABLE hrms.projects ADD COLUMN IF NOT EXISTS code VARCHAR(30);

COMMENT ON COLUMN hrms.projects.code IS
    'An optional short code shown next to the project name on timesheets (V143.65).';

-- ── 3. submitted weeks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.timesheet_weeks (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    employee_id            UUID          NOT NULL REFERENCES hrms.employees (id),
    company_id             UUID,
    week_start             DATE          NOT NULL,
    status                 VARCHAR(12)   NOT NULL,
    total_minutes          INTEGER       NOT NULL DEFAULT 0,
    submitted_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    submitted_by_user_id   UUID,
    decided_at             TIMESTAMPTZ,
    decided_by_user_id     UUID,
    decided_by_employee_id UUID,
    decided_by_name        VARCHAR(200),
    note                   VARCHAR(500),
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_timesheet_weeks_status CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_timesheet_weeks_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    CONSTRAINT ck_timesheet_weeks_minutes CHECK (total_minutes >= 0),
    CONSTRAINT uq_timesheet_weeks_employee_week UNIQUE (tenant_id, employee_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_weeks_status
    ON hrms.timesheet_weeks (tenant_id, status, week_start DESC);

COMMENT ON TABLE hrms.timesheet_weeks IS
    'Timesheet weeks people submitted to their approver (V143.65): SUBMITTED, APPROVED or REJECTED. Entries in a SUBMITTED or APPROVED week are locked. JDBC only.';

ALTER TABLE hrms.timesheet_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.timesheet_weeks FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'timesheet_weeks'
                      AND policyname = 'tenant_isolation_timesheet_weeks') THEN
        CREATE POLICY tenant_isolation_timesheet_weeks ON hrms.timesheet_weeks
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. the permission ────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.timesheet.approve', 'Approve timesheets', 'attendance',
     'Approve or reject the timesheet weeks people in your team submit. HR and admins see everyone''s; managers see their own team''s. An approved week can''t be edited any more; a rejected one opens again.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.33).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code = 'hrms.timesheet.approve'
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.timesheet.approve'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER')
ON CONFLICT DO NOTHING;

-- ── 5. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.timesheet_weeks TO ut_app;
    ELSE
        RAISE NOTICE 'V143.65: role ut_app not present — grants skipped';
    END IF;
END $$;
