-- V143.40: assisted face punch — a manager or HR punches an employee in or out
-- on their own phone, with the employee's face (mobile "Punch for team member",
-- POST /v1/attendance/assisted-punch).
--
-- 1. attendance.assisted_punches — who made each assisted punch ("punched by"),
--    from where and on which phone, linked to the attendance record and to the
--    face check that cleared it. Read and written with JDBC only (no JPA entity
--    maps it), so no entity changes.
-- 2. Permissions, so admins can turn them on or off per role in Roles &
--    permissions:
--      attendance.assisted_punch.team — their team only (the My team rule: the
--        departments they head, else their direct reports). DEPT_MANAGER, MANAGER.
--      attendance.assisted_punch.any  — anyone in the company.
--        HR_MANAGER, ADMIN.
--    OWNER and SUPER_ADMIN get both (OwnerPermissionInvariantCheck refuses to
--    start the app otherwise).
--
-- Numbered 143.40 so it cannot collide with a teammate's migration. Idempotent.
-- Production has Flyway OFF: apply by hand, as a superuser (row-level security).

-- ── 1. who made each assisted punch ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.assisted_punches (
    id                      UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID              NOT NULL,
    attendance_record_id    UUID,
    employee_id             UUID              NOT NULL,
    attendance_date         DATE              NOT NULL,
    punch_type              VARCHAR(10)       NOT NULL,
    punched_at              TIMESTAMPTZ       NOT NULL,
    punched_by_user_id      UUID,
    punched_by_employee_id  UUID,
    punched_by_name         VARCHAR(200),
    face_event_id           UUID,
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    accuracy_m              DOUBLE PRECISION,
    distance_m              INTEGER,
    within_fence            BOOLEAN,
    device_id               VARCHAR(150),
    created_at              TIMESTAMPTZ       NOT NULL DEFAULT now(),
    CONSTRAINT ck_assisted_punches_type CHECK (punch_type IN ('CHECK_IN', 'CHECK_OUT'))
);
CREATE INDEX IF NOT EXISTS idx_assisted_punches_emp_date
    ON attendance.assisted_punches (tenant_id, employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_assisted_punches_face_event
    ON attendance.assisted_punches (tenant_id, face_event_id);
CREATE INDEX IF NOT EXISTS idx_assisted_punches_record
    ON attendance.assisted_punches (tenant_id, attendance_record_id);

COMMENT ON TABLE attendance.assisted_punches IS
    'Punches a manager or HR made for an employee with the employee''s face on their own phone: who, when, where (V143.40).';

ALTER TABLE attendance.assisted_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.assisted_punches FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'assisted_punches'
                      AND policyname = 'tenant_isolation_assisted_punches') THEN
        CREATE POLICY tenant_isolation_assisted_punches ON attendance.assisted_punches
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. permissions ───────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('attendance.assisted_punch.team', 'Punch in/out for their team with a face scan', 'attendance',
     'On the mobile app, punch a member of their own team in or out by scanning that person''s face on their phone. The face must match the person''s enrolled face and the phone must be inside the person''s work area. The punch is recorded as made by them.'),
    ('attendance.assisted_punch.any', 'Punch in/out for anyone with a face scan', 'attendance',
     'On the mobile app, punch anyone in the company in or out by scanning that person''s face on their phone. The face must match the person''s enrolled face and the phone must be inside the person''s work area. The punch is recorded as made by them.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.33).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code IN ('attendance.assisted_punch.team', 'attendance.assisted_punch.any')
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.assisted_punch.team'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'DEPT_MANAGER', 'MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.assisted_punch.any'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'ADMIN')
ON CONFLICT DO NOTHING;

-- ── 3. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.assisted_punches TO ut_app;
    ELSE
        RAISE NOTICE 'V143.40: role ut_app not present — grants skipped';
    END IF;
END $$;
