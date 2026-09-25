-- V143.21: Learning programs gain a delivery mode, and employees can propose
-- their own skill levels (skill self-assessment) for a manager or HR to approve.
--
-- 1. learning_mgmt.training_programs.mode: how a program is delivered
--    (in person, online, hybrid, self-paced). Optional; existing programs stay
--    NULL ("not set"), which the UI shows as such.
-- 2. learning_mgmt.skill_assessments: an employee proposes a proficiency level
--    (1-5) with a note. Their manager (team only) or HR approves or rejects it.
--    Only an APPROVED proposal changes learning_mgmt.employee_skills; the row is
--    kept as the record of who proposed what and who decided.
-- 3. Two permissions, both granted to OWNER and SUPER_ADMIN as well
--    (OwnerPermissionInvariantCheck refuses to start the app otherwise):
--      hrms.learning.skill.assess.self  every employee-carrying role
--      hrms.learning.skill.approve      DEPT_MANAGER, MANAGER, HR_MANAGER
--    Managers only see and decide their own team's proposals (the same team as
--    the My team page); holders of hrms.learning.write (HR) see everyone's.
--
-- The per-employee performance page, the reviewee's KPIs while writing a review,
-- the employee's own KPI history and the "active" KPI filter need no schema
-- change: they read performance_mgmt.goals / kpi_progress_updates as they are.
--
-- Numbered 143.21 so it cannot collide with a teammate's migration. Idempotent.

-- ── 1. Program delivery mode ────────────────────────────────────────────────
ALTER TABLE learning_mgmt.training_programs
    ADD COLUMN IF NOT EXISTS mode VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_training_programs_mode'
           AND conrelid = 'learning_mgmt.training_programs'::regclass) THEN
        ALTER TABLE learning_mgmt.training_programs
            ADD CONSTRAINT ck_training_programs_mode
            CHECK (mode IS NULL OR mode IN ('IN_PERSON', 'ONLINE', 'HYBRID', 'SELF_PACED'));
    END IF;
END $$;
-- Seats are validated by the API (at least one, and never fewer than the people
-- already enrolled). No CHECK here on purpose: an older program saved with 0
-- seats must still accept a status change.

-- ── 2. Skill self-assessments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_mgmt.skill_assessments (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    employee_id            UUID          NOT NULL,
    -- The skill row this proposal is about, when one existed at proposal time.
    skill_id               UUID          REFERENCES learning_mgmt.employee_skills(id) ON DELETE SET NULL,
    skill_name             VARCHAR(120)  NOT NULL,
    -- Recorded level when the proposal was made (NULL for a new skill).
    current_proficiency    INT,
    proposed_proficiency   INT           NOT NULL,
    employee_note          TEXT,
    status                 VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    decided_by_employee_id UUID,
    decided_by_user_id     UUID,
    decided_at             TIMESTAMPTZ,
    decision_note          TEXT,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by             VARCHAR(255),
    updated_by             VARCHAR(255),
    version                BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT ck_skill_assessment_level   CHECK (proposed_proficiency BETWEEN 1 AND 5),
    CONSTRAINT ck_skill_assessment_current CHECK (current_proficiency IS NULL OR current_proficiency BETWEEN 1 AND 5),
    CONSTRAINT ck_skill_assessment_status  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT ck_skill_assessment_note    CHECK (employee_note IS NULL OR length(employee_note) <= 1000),
    CONSTRAINT ck_skill_assessment_dnote   CHECK (decision_note IS NULL OR length(decision_note) <= 1000)
);

-- One open proposal per person per skill (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_assessments_one_pending
    ON learning_mgmt.skill_assessments (tenant_id, employee_id, lower(skill_name))
 WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_skill_assessments_status
    ON learning_mgmt.skill_assessments (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_assessments_employee
    ON learning_mgmt.skill_assessments (tenant_id, employee_id, created_at DESC);

ALTER TABLE learning_mgmt.skill_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_mgmt.skill_assessments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'learning_mgmt' AND tablename = 'skill_assessments'
           AND policyname = 'tenant_isolation_skill_assessments') THEN
        CREATE POLICY tenant_isolation_skill_assessments ON learning_mgmt.skill_assessments
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. Permissions ──────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.learning.skill.assess.self', 'Propose my skill levels', 'learning',
     'Propose a proficiency level (1 to 5) for your own skills, with a note. Nothing changes on your record until your manager or HR approves it.'),
    ('hrms.learning.skill.approve', 'Approve skill self-assessments', 'learning',
     'Approve or reject the skill levels employees propose for themselves. Approving updates the employee''s skill matrix. Managers see only their own team; people who can manage learning programs and skills (HR) see every proposal.')
-- module 'learning' groups them with the other hrms.learning.* permissions on the
-- Roles & Permissions screen; re-running the file corrects an earlier copy.
ON CONFLICT (code) DO UPDATE
   SET display_name = EXCLUDED.display_name,
       module       = EXCLUDED.module,
       description  = EXCLUDED.description;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.learning.skill.assess.self'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD',
                  'DEPT_MANAGER', 'MANAGER', 'EMPLOYEE')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.learning.skill.approve'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'MANAGER')
ON CONFLICT DO NOTHING;

-- ── 4. Grants for the application role ─────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA learning_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON learning_mgmt.skill_assessments TO ut_app;
    END IF;
END $$;
