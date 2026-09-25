-- V143.10 — attendance timing policy, day-status review, face punch review,
-- regularization proof and per-company attendance rules (w1a, 2026-09-25).
--
-- 1. attendance.timing_policies — one row per company: start time for people
--    without a shift, half-day rules (late by X minutes / worked under Y
--    hours), minimum hours, early-leave threshold and the late ALLOWANCE
--    (N late arrivals per week or month, then Late / Half day / Loss of pay).
--    The company grace stays in settings.hr_configuration.late_grace_minutes
--    (the mobile Work Time screen already writes it there) so there is ONE
--    grace per company. Existing companies are seeded here; new companies get
--    the same defaults lazily on first read (AttendancePolicyService).
-- 2. attendance.day_status_reviews — append-only audit of every manual status
--    change (who, when, from -> to, reason). The newest SET / EXCUSE / CLEAR
--    row for an employee-day is the day's manual status.
-- 3. attendance.face_event_reviews — HR decisions on face punches ("Yes, it's
--    them" / "Not them"), append-only; the newest row per event wins.
-- 4. attendance.records.check_in_outside_geofence / check_in_distance_m —
--    set when a check-in outside the zone was accepted (geofence not enforced
--    for the company), so reviewers can see it.
-- 5. Permissions attendance.policy.manage, attendance.status.review and
--    attendance.status.override (OWNER and SUPER_ADMIN get every one, or the
--    app refuses to start — OwnerPermissionInvariantCheck).
--
-- Numbered 143.10 so it cannot collide with a teammate's V144. Idempotent.
-- Production has Flyway OFF: apply by hand after V143_9.

-- ── 1. timing policies ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.timing_policies (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL,
    default_start_time      TIME          NOT NULL DEFAULT '09:15',
    half_day_late_minutes   INT,
    full_day_min_hours      NUMERIC(4,2),
    half_day_min_hours      NUMERIC(4,2),
    early_leave_minutes     INT           NOT NULL DEFAULT 0,
    late_allowance_count    INT           NOT NULL DEFAULT 0,
    late_allowance_period   VARCHAR(10)   NOT NULL DEFAULT 'MONTH',
    after_allowance_action  VARCHAR(20)   NOT NULL DEFAULT 'KEEP_LATE',
    updated_by_user_id      UUID,
    updated_by_name         VARCHAR(200),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_timing_policy_company UNIQUE (tenant_id, company_id),
    CONSTRAINT ck_timing_policy_period CHECK (late_allowance_period IN ('WEEK', 'MONTH')),
    CONSTRAINT ck_timing_policy_action CHECK (after_allowance_action IN ('KEEP_LATE', 'HALF_DAY', 'LOSS_OF_PAY')),
    CONSTRAINT ck_timing_policy_ranges CHECK (
        early_leave_minutes BETWEEN 0 AND 600
        AND late_allowance_count BETWEEN 0 AND 31
        AND (half_day_late_minutes IS NULL OR half_day_late_minutes BETWEEN 1 AND 720)
        AND (full_day_min_hours IS NULL OR (full_day_min_hours > 0 AND full_day_min_hours <= 24))
        AND (half_day_min_hours IS NULL OR (half_day_min_hours > 0 AND half_day_min_hours <= 24)))
);
CREATE INDEX IF NOT EXISTS idx_timing_policies_tenant ON attendance.timing_policies (tenant_id);

ALTER TABLE attendance.timing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.timing_policies FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'timing_policies'
                      AND policyname = 'tenant_isolation_timing_policies') THEN
        CREATE POLICY tenant_isolation_timing_policies ON attendance.timing_policies
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- Defaults for every existing company (same values the service falls back to).
INSERT INTO attendance.timing_policies (tenant_id, company_id)
SELECT c.tenant_id, c.id FROM org.companies c
ON CONFLICT (tenant_id, company_id) DO NOTHING;

-- ── 2. day status reviews (audit of manual status changes) ──────────────────
CREATE TABLE IF NOT EXISTS attendance.day_status_reviews (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    employee_id           UUID          NOT NULL,
    company_id            UUID,
    attendance_date       DATE          NOT NULL,
    action                VARCHAR(20)   NOT NULL,
    from_status           VARCHAR(20),
    to_status             VARCHAR(20),
    reason                TEXT          NOT NULL,
    face_event_id         UUID,
    reviewer_user_id      UUID,
    reviewer_employee_id  UUID,
    reviewer_name         VARCHAR(200),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_day_status_reviews_action CHECK (action IN ('SET', 'EXCUSE', 'CLEAR', 'FACE_REJECT', 'FACE_CONFIRM')),
    CONSTRAINT ck_day_status_reviews_to CHECK (to_status IS NULL OR to_status IN
        ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'NOT_MARKED', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_TRACKED', 'UPCOMING')),
    CONSTRAINT ck_day_status_reviews_from CHECK (from_status IS NULL OR from_status IN
        ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'NOT_MARKED', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_TRACKED', 'UPCOMING'))
);
CREATE INDEX IF NOT EXISTS idx_day_status_reviews_emp_date
    ON attendance.day_status_reviews (tenant_id, employee_id, attendance_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_day_status_reviews_date
    ON attendance.day_status_reviews (tenant_id, attendance_date);

ALTER TABLE attendance.day_status_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.day_status_reviews FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'day_status_reviews'
                      AND policyname = 'tenant_isolation_day_status_reviews') THEN
        CREATE POLICY tenant_isolation_day_status_reviews ON attendance.day_status_reviews
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. face punch reviews ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.face_event_reviews (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    event_id              UUID          NOT NULL,
    employee_id           UUID,
    attendance_date       DATE          NOT NULL,
    decision              VARCHAR(20)   NOT NULL,
    note                  TEXT,
    reviewer_user_id      UUID,
    reviewer_employee_id  UUID,
    reviewer_name         VARCHAR(200),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_face_event_reviews_decision CHECK (decision IN ('CONFIRMED', 'REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_face_event_reviews_event
    ON attendance.face_event_reviews (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_face_event_reviews_emp_date
    ON attendance.face_event_reviews (tenant_id, employee_id, attendance_date);

ALTER TABLE attendance.face_event_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.face_event_reviews FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'face_event_reviews'
                      AND policyname = 'tenant_isolation_face_event_reviews') THEN
        CREATE POLICY tenant_isolation_face_event_reviews ON attendance.face_event_reviews
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. accepted check-ins outside the zone ───────────────────────────────────
-- Nullable, no default: a metadata-only change on the partitioned table.
ALTER TABLE attendance.records ADD COLUMN IF NOT EXISTS check_in_outside_geofence BOOLEAN;
ALTER TABLE attendance.records ADD COLUMN IF NOT EXISTS check_in_distance_m INTEGER;

-- ── 5. permissions ───────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('attendance.policy.manage', 'Manage the attendance timing policy', 'attendance',
     'Change a company''s attendance timing rules: grace time, start time for people without a shift, half-day rules, minimum hours, early leave and the late allowance. Warning: this changes how late, half-day and absent days are counted for everyone in that company, and payroll can deduct pay for them.'),
    ('attendance.status.review', 'See attendance exceptions', 'attendance',
     'See the attendance review list: late arrivals, half days, early leaving, absences, days nobody marked, unsure face punches and check-ins outside the zone. Department managers see only their own team.'),
    ('attendance.status.override', 'Change a day''s attendance status', 'attendance',
     'Excuse a day or set it to Present, Late, Half day or Absent with a reason, and confirm or reject face punches. Every change is recorded and the employee is told. Warning: the new status is what payroll counts, so it can change someone''s pay. Department managers can change only their own team''s days.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.policy.manage'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('attendance.status.review'), ('attendance.status.override')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'DEPT_MANAGER')
ON CONFLICT DO NOTHING;

-- ── 6. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.timing_policies TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.day_status_reviews TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.face_event_reviews TO ut_app;
    ELSE
        RAISE NOTICE 'V143.10: role ut_app not present — grants skipped';
    END IF;
END $$;
