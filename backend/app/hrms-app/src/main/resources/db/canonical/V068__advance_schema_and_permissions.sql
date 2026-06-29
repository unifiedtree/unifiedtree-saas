-- ============================================================================
-- V068 - advance_mgmt schema (salary advance requests) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Salary advances: employee self-service requests, manager/HR approval, and
-- finance disbursement with payroll-recovered repayment. Tenant isolation via
-- RLS using current_tenant_id() (the SET LOCAL app.tenant_id GUC set per
-- request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS advance_mgmt;

-- ── advance_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS advance_mgmt.advance_requests (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID          NOT NULL,
    employee_id        UUID          NOT NULL,
    company_id         UUID          NOT NULL,
    amount             NUMERIC(15,2) NOT NULL,
    reason             TEXT,
    repayment_months   INT           NOT NULL,
    monthly_deduction  NUMERIC(15,2) NOT NULL,
    status             VARCHAR(30)   NOT NULL DEFAULT 'REQUESTED',
    approver_id        UUID,
    approved_at        TIMESTAMPTZ,
    approver_comment   TEXT,
    disbursed_at       TIMESTAMPTZ,
    outstanding_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by         VARCHAR(255),
    updated_by         VARCHAR(255),
    version            BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_advance_requests_employee ON advance_mgmt.advance_requests (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_advance_requests_approver ON advance_mgmt.advance_requests (tenant_id, approver_id, status);
CREATE INDEX IF NOT EXISTS idx_advance_requests_status   ON advance_mgmt.advance_requests (tenant_id, status);

ALTER TABLE advance_mgmt.advance_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_advance_requests ON advance_mgmt.advance_requests;
CREATE POLICY tenant_isolation_advance_requests ON advance_mgmt.advance_requests
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032 / V067, guarded so
-- this runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA advance_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA advance_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA advance_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA advance_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.advance.request.self', 'Request own salary advance', 'advance'),
    ('hrms.advance.read',         'View salary advances',       'advance'),
    ('hrms.advance.approve',      'Approve salary advances',    'advance'),
    ('hrms.advance.disburse',     'Disburse salary advances',   'advance')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): request own + read + approve.
-- FINANCE_LEAD (...0003): request own + read + disburse.
-- DEPT_MANAGER (...0005): request own + read + approve.
-- EMPLOYEE (...0004): request own advance.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.advance.request.self'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.advance.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.advance.approve'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.advance.disburse'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.advance.request.self'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.advance.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.advance.approve'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.advance.disburse'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.advance.request.self'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.advance.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.advance.approve'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.advance.request.self'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.advance.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.advance.disburse'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.advance.request.self'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.advance.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.advance.approve'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.advance.request.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.advance.%';
    RAISE NOTICE 'Advance permission grants: % (expect 18)', cnt;
END $$;
