-- V143.20: interview scheduling + scorecards, onboarding hire details,
-- "my assets" for employees.
--
-- 1. hiring_mgmt.interviews / interview_interviewers / interview_scorecards.
--    HR (or a department manager) schedules an interview for a candidate who
--    is in Screening or Interview: date and time (stored as an instant, entered
--    in IST), duration, mode (in person / video / phone), where or the link,
--    the interviewers (employees) and the criteria they rate. Each assigned
--    interviewer submits one scorecard: a 1-5 rating per criterion, strengths,
--    concerns and a recommendation (strong yes / yes / no / strong no).
-- 2. hrms.onboarding_instances gets the hire details the employee workspace's
--    Onboarding record shows: offer accepted date, hiring manager, recruiter,
--    source and buddy, plus the candidate the hire came from. They are filled
--    from the candidate, requisition and accepted offer when the onboarding
--    starts for a converted candidate, and HR can edit them.
-- 3. Permissions:
--      hrms.hiring.interview.write  schedule, reschedule and cancel interviews
--      hrms.hiring.interview.self   see the interviews you are on and submit
--                                   your scorecard (every employee: anyone
--                                   can be asked to interview)
--      hrms.onboarding.asset.self   see the company equipment you hold
--    OWNER and SUPER_ADMIN receive every one (OwnerPermissionInvariantCheck).
--
-- Numbered 143.20 (assigned slot). Idempotent. Production has Flyway off:
-- apply by hand after V143_9 and the other V143_x files.

-- ── 1. Interviews ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_mgmt.interviews (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    candidate_id      UUID          NOT NULL REFERENCES hiring_mgmt.candidates(id) ON DELETE CASCADE,
    title             VARCHAR(120)  NOT NULL,
    scheduled_at      TIMESTAMPTZ   NOT NULL,
    duration_minutes  INT           NOT NULL,
    mode              VARCHAR(20)   NOT NULL,
    location          VARCHAR(500),
    criteria          JSONB         NOT NULL DEFAULT '[]'::jsonb,
    notes             TEXT,
    status            VARCHAR(20)   NOT NULL DEFAULT 'SCHEDULED',
    cancel_reason     TEXT,
    cancelled_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_by        UUID,
    CONSTRAINT ck_interview_mode     CHECK (mode IN ('IN_PERSON', 'VIDEO', 'PHONE')),
    CONSTRAINT ck_interview_status   CHECK (status IN ('SCHEDULED', 'CANCELLED')),
    CONSTRAINT ck_interview_duration CHECK (duration_minutes BETWEEN 15 AND 480)
);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON hiring_mgmt.interviews (tenant_id, candidate_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_interviews_upcoming  ON hiring_mgmt.interviews (tenant_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS hiring_mgmt.interview_interviewers (
    tenant_id     UUID         NOT NULL,
    interview_id  UUID         NOT NULL REFERENCES hiring_mgmt.interviews(id) ON DELETE CASCADE,
    employee_id   UUID         NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (interview_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_interview_interviewers_employee ON hiring_mgmt.interview_interviewers (tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS hiring_mgmt.interview_scorecards (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    interview_id    UUID          NOT NULL REFERENCES hiring_mgmt.interviews(id) ON DELETE CASCADE,
    interviewer_id  UUID          NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
    -- [{"criterion": "Communication", "rating": 4}, ...], one entry per interview criterion, ratings 1-5
    ratings         JSONB         NOT NULL,
    overall_rating  NUMERIC(3,2)  NOT NULL,
    strengths       TEXT,
    concerns        TEXT,
    recommendation  VARCHAR(20)   NOT NULL,
    submitted_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_scorecard_interviewer UNIQUE (interview_id, interviewer_id),
    CONSTRAINT ck_scorecard_recommendation CHECK (recommendation IN ('STRONG_YES', 'YES', 'NO', 'STRONG_NO')),
    CONSTRAINT ck_scorecard_overall CHECK (overall_rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_interview_scorecards_interview ON hiring_mgmt.interview_scorecards (tenant_id, interview_id);

ALTER TABLE hiring_mgmt.interviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_mgmt.interview_interviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_mgmt.interview_scorecards   ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hiring_mgmt' AND tablename = 'interviews'
                     AND policyname = 'tenant_isolation_interviews') THEN
        CREATE POLICY tenant_isolation_interviews ON hiring_mgmt.interviews
            USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hiring_mgmt' AND tablename = 'interview_interviewers'
                     AND policyname = 'tenant_isolation_interview_interviewers') THEN
        CREATE POLICY tenant_isolation_interview_interviewers ON hiring_mgmt.interview_interviewers
            USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hiring_mgmt' AND tablename = 'interview_scorecards'
                     AND policyname = 'tenant_isolation_interview_scorecards') THEN
        CREATE POLICY tenant_isolation_interview_scorecards ON hiring_mgmt.interview_scorecards
            USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. Onboarding hire details ────────────────────────────────────────────
ALTER TABLE hrms.onboarding_instances
    ADD COLUMN IF NOT EXISTS candidate_id       UUID,
    ADD COLUMN IF NOT EXISTS offer_accepted_on  DATE,
    ADD COLUMN IF NOT EXISTS hiring_manager_id  UUID,
    ADD COLUMN IF NOT EXISTS recruiter_id       UUID,
    ADD COLUMN IF NOT EXISTS buddy_id           UUID,
    ADD COLUMN IF NOT EXISTS hire_source        VARCHAR(80);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_onboarding_instances_candidate') THEN
        ALTER TABLE hrms.onboarding_instances ADD CONSTRAINT fk_onboarding_instances_candidate
            FOREIGN KEY (candidate_id) REFERENCES hiring_mgmt.candidates(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_onboarding_instances_hiring_manager') THEN
        ALTER TABLE hrms.onboarding_instances ADD CONSTRAINT fk_onboarding_instances_hiring_manager
            FOREIGN KEY (hiring_manager_id) REFERENCES hrms.employees(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_onboarding_instances_recruiter') THEN
        ALTER TABLE hrms.onboarding_instances ADD CONSTRAINT fk_onboarding_instances_recruiter
            FOREIGN KEY (recruiter_id) REFERENCES hrms.employees(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_onboarding_instances_buddy') THEN
        ALTER TABLE hrms.onboarding_instances ADD CONSTRAINT fk_onboarding_instances_buddy
            FOREIGN KEY (buddy_id) REFERENCES hrms.employees(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── 3. Permissions ────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.hiring.interview.write', 'Schedule interviews', 'hiring',
     'Schedule, reschedule and cancel interviews for candidates, and choose the interviewers. The interviewers are notified of every change.'),
    ('hrms.hiring.interview.self', 'Take part in interviews', 'hiring',
     'See the interviews you have been asked to take and submit your scorecard for them. It shows nothing else about the hiring pipeline.'),
    ('hrms.onboarding.asset.self', 'See my assets', 'onboarding',
     'See the company equipment (laptop, ID card, phone...) currently handed to you and what you have returned.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.hiring.interview.write'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER')
ON CONFLICT DO NOTHING;

-- Self permissions: every built-in role. EMPLOYEE is the baseline every
-- person with an employee record inherits (EmployeeBaselinePermissions).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('hrms.hiring.interview.self'), ('hrms.onboarding.asset.self')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'MANAGER', 'EMPLOYEE')
ON CONFLICT DO NOTHING;

-- ── 4. Grants for the runtime role ────────────────────────────────────────
DO $$
DECLARE
    t   TEXT;
    tbl TEXT[] := ARRAY[
        'hiring_mgmt.interviews',
        'hiring_mgmt.interview_interviewers',
        'hiring_mgmt.interview_scorecards'
    ];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        RAISE NOTICE 'V143_20: role ut_app not present, grants skipped';
        RETURN;
    END IF;
    GRANT USAGE ON SCHEMA hiring_mgmt TO ut_app;
    FOREACH t IN ARRAY tbl LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO ut_app', t);
    END LOOP;
END $$;
