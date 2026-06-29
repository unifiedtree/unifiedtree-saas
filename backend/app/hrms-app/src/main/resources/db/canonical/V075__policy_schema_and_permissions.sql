-- ============================================================================
-- V075 - policy_mgmt schema (hr_policies, policy_acknowledgements) + RBAC perms
-- ----------------------------------------------------------------------------
-- HR policy publication and employee acknowledgement: HR publishes versioned
-- policies; employees read and acknowledge them. Tenant isolation via RLS using
-- current_tenant_id() (the SET LOCAL app.tenant_id GUC set per request).
--
-- Flyway is DISABLED in production, so this migration is applied manually with
-- the backend deploy. Written idempotently (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / ON CONFLICT) so a manual re-run is safe.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS policy_mgmt;

-- ── hr_policies ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_mgmt.hr_policies (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    company_id     UUID          NOT NULL,
    title          VARCHAR(200)  NOT NULL,
    category       VARCHAR(50),
    content        TEXT,
    policy_version VARCHAR(20),
    effective_date DATE,
    status         VARCHAR(30)   NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hr_policies_company ON policy_mgmt.hr_policies (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_policies_status  ON policy_mgmt.hr_policies (tenant_id, status);

ALTER TABLE policy_mgmt.hr_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_hr_policies ON policy_mgmt.hr_policies;
CREATE POLICY tenant_isolation_hr_policies ON policy_mgmt.hr_policies
    USING (tenant_id = current_tenant_id());

-- ── policy_acknowledgements ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_mgmt.policy_acknowledgements (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    policy_id       UUID          NOT NULL REFERENCES policy_mgmt.hr_policies(id) ON DELETE CASCADE,
    employee_id     UUID,
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_policy_ack_policy   ON policy_mgmt.policy_acknowledgements (tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_ack_employee ON policy_mgmt.policy_acknowledgements (tenant_id, employee_id);
-- One acknowledgement per employee per policy (enforces service-side idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_ack_policy_employee
    ON policy_mgmt.policy_acknowledgements (tenant_id, policy_id, employee_id);

ALTER TABLE policy_mgmt.policy_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy_acknowledgements ON policy_mgmt.policy_acknowledgements;
CREATE POLICY tenant_isolation_policy_acknowledgements ON policy_mgmt.policy_acknowledgements
    USING (tenant_id = current_tenant_id());

-- ── Grant the runtime application role(s) access to the new schema ──────────
-- The app connects as a non-owner role whose access is gated by RLS. Mirror the
-- dual-role pattern (hrms_app / app_user) used by V025 / V032, guarded so this
-- runs cleanly on environments that only have one of them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA policy_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA policy_mgmt TO hrms_app;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA policy_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA policy_mgmt TO app_user;
        GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
    END IF;
END $$;

-- ── RBAC permission catalog ─────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.policy.read',             'View HR policies',          'policy'),
    ('hrms.policy.write',            'Manage HR policies',        'policy'),
    ('hrms.policy.acknowledge.self', 'Acknowledge HR policies',   'policy')
ON CONFLICT (code) DO NOTHING;

-- ── Grant permissions to system roles ───────────────────────────────────────
-- SUPER_ADMIN (...0001) and OWNER (...0010): full superset.
-- HR_MANAGER (...0002): manage policies + read + acknowledge.
-- FINANCE_LEAD (...0003): read + acknowledge.
-- DEPT_MANAGER (...0005): read + acknowledge.
-- EMPLOYEE (...0004): read + acknowledge.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000001', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.policy.write'),
    ('00000000-0000-0000-0000-000000000001', 'hrms.policy.acknowledge.self'),
    -- OWNER
    ('00000000-0000-0000-0000-000000000010', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.policy.write'),
    ('00000000-0000-0000-0000-000000000010', 'hrms.policy.acknowledge.self'),
    -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000002', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.policy.write'),
    ('00000000-0000-0000-0000-000000000002', 'hrms.policy.acknowledge.self'),
    -- FINANCE_LEAD
    ('00000000-0000-0000-0000-000000000003', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000003', 'hrms.policy.acknowledge.self'),
    -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000005', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000005', 'hrms.policy.acknowledge.self'),
    -- EMPLOYEE
    ('00000000-0000-0000-0000-000000000004', 'hrms.policy.read'),
    ('00000000-0000-0000-0000-000000000004', 'hrms.policy.acknowledge.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM rbac.role_permissions
     WHERE permission_code LIKE 'hrms.policy.%';
    RAISE NOTICE 'Policy permission grants: % (expect 15)', cnt;
END $$;
