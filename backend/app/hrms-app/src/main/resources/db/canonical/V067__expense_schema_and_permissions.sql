-- ============================================================================
-- V067 - expense_mgmt schema (policies, claims, items) + RBAC permissions
-- ----------------------------------------------------------------------------
-- Employee expense reimbursement: policy definition, claim submission, manager/
-- HR approval, and finance reimbursement. Tenant isolation via RLS using
-- current_tenant_id() (the SET LOCAL app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS expense_mgmt;

-- ── expense_policies ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_mgmt.expense_policies (
    id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID          NOT NULL,
    company_id                UUID          NOT NULL,
    name                      VARCHAR(200)  NOT NULL,
    category                  VARCHAR(50)   NOT NULL,
    max_amount_per_claim      NUMERIC(15,2),
    requires_receipt          BOOLEAN       NOT NULL DEFAULT TRUE,
    requires_manager_approval BOOLEAN       NOT NULL DEFAULT TRUE,
    requires_hr_approval      BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by                VARCHAR(255),
    updated_by                VARCHAR(255),
    version                   BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expense_policies_company ON expense_mgmt.expense_policies (tenant_id, company_id, is_active);

ALTER TABLE expense_mgmt.expense_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_expense_policies ON expense_mgmt.expense_policies;
CREATE POLICY tenant_isolation_expense_policies ON expense_mgmt.expense_policies
    USING (tenant_id = current_tenant_id());

-- ── expense_claims ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_mgmt.expense_claims (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    employee_id      UUID          NOT NULL,
    company_id       UUID          NOT NULL,
    title            VARCHAR(300)  NOT NULL,
    total_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency         VARCHAR(10)   DEFAULT 'INR',
    status           VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',
    submitted_at     TIMESTAMPTZ,
    approver_id      UUID,
    approved_at      TIMESTAMPTZ,
    approver_comment TEXT,
    reimbursed_at    TIMESTAMPTZ,
    notes            TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expense_claims_employee ON expense_mgmt.expense_claims (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_approver ON expense_mgmt.expense_claims (tenant_id, approver_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_status   ON expense_mgmt.expense_claims (tenant_id, status);

ALTER TABLE expense_mgmt.expense_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_expense_claims ON expense_mgmt.expense_claims;
CREATE POLICY tenant_isolation_expense_claims ON expense_mgmt.expense_claims
    USING (tenant_id = current_tenant_id());

-- ── expense_items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_mgmt.expense_items (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    claim_id      UUID          NOT NULL REFERENCES expense_mgmt.expense_claims(id) ON DELETE CASCADE,
    category      VARCHAR(50)   NOT NULL,
    description   TEXT,
    amount        NUMERIC(15,2) NOT NULL,
    expense_date  DATE          NOT NULL,
    receipt_url   TEXT,
    merchant_name VARCHAR(200),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expense_items_claim ON expense_mgmt.expense_items (tenant_id, claim_id);

ALTER TABLE expense_mgmt.expense_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_expense_items ON expense_mgmt.expense_items;
CREATE POLICY tenant_isolation_expense_items ON expense_mgmt.expense_items
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA expense_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA expense_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA expense_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA expense_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.expense.claim.self',    'Submit own expense claims', 'expense'),
    ('hrms.expense.claim.read',    'View expense claims',       'expense'),
    ('hrms.expense.claim.approve', 'Approve expense claims',    'expense'),
    ('hrms.expense.policy.read',   'View expense policies',     'expense'),
    ('hrms.expense.policy.write',  'Manage expense policies',   'expense'),
    ('hrms.expense.reimbursement', 'Process reimbursement',     'expense')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): manage policies + approve.
-- FINANCE_LEAD (...0003): read claims/policies + reimburse + own claims.
-- DEPT_MANAGER (...0005): approve team claims + own claims.
-- EMPLOYEE (...0004): submit own claims.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.claim.self'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.claim.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.claim.approve'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.policy.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.policy.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.expense.reimbursement'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.claim.self'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.claim.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.claim.approve'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.policy.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.policy.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.expense.reimbursement'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.expense.claim.self'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.expense.claim.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.expense.claim.approve'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.expense.policy.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.expense.policy.write'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.expense.claim.self'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.expense.claim.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.expense.policy.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.expense.reimbursement'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.expense.claim.self'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.expense.claim.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.expense.claim.approve'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.expense.claim.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.expense.%';
    RAISE NOTICE 'Expense permission grants: % (expect 25)', cnt;
END $$;
