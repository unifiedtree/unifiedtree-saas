-- ============================================================================
-- V085 - Work From Home request/approval schema
-- ----------------------------------------------------------------------------
-- Adds leave_mgmt.wfh_requests plus RBAC permissions so employees can apply
-- for Work From Home and managers can approve. When an approved WFH day
-- overlaps today's IST date, AttendanceController skips the OUTSIDE_GEOFENCE
-- throw so the employee can punch from home. Face-recognition + FACE_MISMATCH
-- checks are NOT bypassed — WFH is a location override, not an identity
-- verification bypass.
--
-- Flyway is DISABLED on Railway (SPRING_FLYWAY_ENABLED=false; ut_app has no
-- access to the flyway_schema_history table) — this file is documentation and
-- the operator applies it manually via scripts/apply-migration.py (psycopg)
-- as the superuser role. Written idempotently (IF NOT EXISTS / DROP POLICY
-- IF EXISTS / ON CONFLICT) so a manual re-run is safe.
--
-- ut_app grant note: V079 taught that a new table without an explicit ut_app
-- GRANT returns a raw 500 on every endpoint that touches it — the app role
-- has no default privileges on new tables in leave_mgmt. Grant to
-- ut_app / hrms_app / app_user (all three roles that historically front the
-- runtime connection depending on environment) inside a DO block that only
-- attempts a role that actually exists.
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_mgmt.wfh_requests (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    employee_id    UUID          NOT NULL,
    from_date      DATE          NOT NULL,
    to_date        DATE          NOT NULL,
    reason         TEXT,
    status         VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
    approver_id    UUID,
    decided_at     TIMESTAMPTZ,
    decision_note  TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT ck_wfh_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    CONSTRAINT ck_wfh_dates  CHECK (to_date >= from_date)
);

-- Query patterns:
--   * employee's own history           (tenant_id, employee_id, from_date DESC)
--   * approver queue                   (tenant_id, approver_id, status)
--   * "is today an approved WFH day"   (tenant_id, employee_id, from_date, to_date)
--     — partial index on status='APPROVED' keeps it tight since the hot read is
--     from AttendanceService.isApprovedWfhDay, hit on every check-in.
CREATE INDEX IF NOT EXISTS idx_wfh_emp
    ON leave_mgmt.wfh_requests (tenant_id, employee_id, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_wfh_approver
    ON leave_mgmt.wfh_requests (tenant_id, approver_id, status);
CREATE INDEX IF NOT EXISTS idx_wfh_active
    ON leave_mgmt.wfh_requests (tenant_id, employee_id, from_date, to_date)
    WHERE status = 'APPROVED';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE leave_mgmt.wfh_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.wfh_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_wfh ON leave_mgmt.wfh_requests;
CREATE POLICY tenant_isolation_wfh ON leave_mgmt.wfh_requests
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Grants to runtime application roles ─────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
    FOR r IN SELECT unnest(ARRAY['ut_app','hrms_app','app_user']) LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA leave_mgmt TO %I', r);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON leave_mgmt.wfh_requests TO %I', r);
            EXECUTE format('GRANT EXECUTE ON FUNCTION current_tenant_id() TO %I', r);
        END IF;
    END LOOP;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('wfh.request.self', 'Apply for Work From Home', 'wfh'),
    ('wfh.approve',      'Approve WFH requests',    'wfh')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- Every active role gets wfh.request.self so any employee can apply. Only the
-- approver roles get wfh.approve.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN  (self-service so an admin acting as an employee can apply)
    ('00000000-0000-0000-0000-000000000001', 'wfh.request.self'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'wfh.request.self'),
    -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000003', 'wfh.request.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'wfh.request.self'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'wfh.request.self'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'wfh.request.self'),

    -- Approver roles
    ('00000000-0000-0000-0000-000000000001', 'wfh.approve'),  -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000002', 'wfh.approve'),  -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'wfh.approve'),  -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'wfh.approve'),  -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000010', 'wfh.approve')   -- OWNER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
    perms      INT;
    grants     INT;
BEGIN
    SELECT count(*) INTO perms
      FROM rbac.permissions
     WHERE code LIKE 'wfh.%';
    SELECT count(*) INTO grants
      FROM rbac.role_permissions
     WHERE permission_code LIKE 'wfh.%';
    RAISE NOTICE 'V085 WFH permissions: % (expect 2)', perms;
    RAISE NOTICE 'V085 WFH role grants: % (expect 11)', grants;
END $$;
