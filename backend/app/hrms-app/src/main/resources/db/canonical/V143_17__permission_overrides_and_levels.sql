-- V143.17: per-person permission overrides, permission risk levels, and the
-- permissions that replace the last role-name checks in the API.
--
-- 1. rbac.permissions gains risk_level (LOW / MEDIUM / HIGH / CRITICAL) and a
--    plain-English warning. The Roles & permissions catalogue and the Manage
--    access drawer show them, and granting a HIGH or CRITICAL permission asks
--    for confirmation. Only the workspace OWNER can grant CRITICAL ones.
--    (Descriptions and levels for every permission are in V143_17_1.)
-- 2. rbac.user_permission_overrides: give one person an extra permission
--    (GRANT) or take away one their role gives them (DENY), with a required
--    reason, who did it, and an optional expiry. Effective permissions =
--    (role grants + employee baseline + GRANT overrides) minus DENY overrides.
-- 3. New permissions:
--      rbac.access.manage-overrides  who may add or remove per-person overrides
--      hrms.employee.team.manage     what department managers relied on their
--                                    role NAME for in /v1/employees/* (add
--                                    staff to their department, set their
--                                    team's punch zone and weekly offs, look up
--                                    their direct reports)
--    OWNER and SUPER_ADMIN receive both (OwnerPermissionInvariantCheck).
-- 4. SUPER_ADMIN also receives settings.read and workspace.modules.read, the
--    two read-only permissions it was missing. Without them the new "you may
--    only give roles whose permissions you hold" rule would stop a super admin
--    from giving someone the Finance Lead or Admin role.
--
-- Numbered 143.17 so it cannot collide with a teammate's migration. Idempotent.

-- ── 1. Risk level + warning on the permission catalogue ─────────────────────
ALTER TABLE rbac.permissions
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(10) NOT NULL DEFAULT 'LOW',
    ADD COLUMN IF NOT EXISTS warning    TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_permissions_risk_level'
           AND conrelid = 'rbac.permissions'::regclass) THEN
        ALTER TABLE rbac.permissions
            ADD CONSTRAINT ck_permissions_risk_level
            CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
    END IF;
END $$;

-- ── 2. Per-person overrides ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rbac.user_permission_overrides (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    user_id          UUID          NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    permission_code  VARCHAR(100)  NOT NULL REFERENCES rbac.permissions(code) ON DELETE CASCADE,
    effect           VARCHAR(10)   NOT NULL,
    reason           TEXT          NOT NULL,
    granted_by       UUID,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ,
    CONSTRAINT ck_upo_effect CHECK (effect IN ('GRANT', 'DENY')),
    CONSTRAINT ck_upo_reason CHECK (length(btrim(reason)) > 0),
    CONSTRAINT uq_upo_user_permission UNIQUE (tenant_id, user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_upo_tenant_user
    ON rbac.user_permission_overrides (tenant_id, user_id);

ALTER TABLE rbac.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.user_permission_overrides FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'rbac' AND tablename = 'user_permission_overrides'
           AND policyname = 'tenant_isolation_user_permission_overrides') THEN
        CREATE POLICY tenant_isolation_user_permission_overrides
            ON rbac.user_permission_overrides
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON rbac.user_permission_overrides TO ut_app;
    END IF;
END $$;

-- ── 3. New permissions ──────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description, risk_level, warning) VALUES
    ('rbac.access.manage-overrides', 'Give or remove individual permissions', 'rbac',
     'Give one person an extra permission, or take away a permission their role would give them, with a reason and an optional end date. You can only give permissions you hold yourself.',
     'CRITICAL',
     'Controls who can do what. Only the workspace owner can give this to someone.'),
    ('hrms.employee.team.manage', 'Manage your team''s staff records', 'hrms',
     'For department managers: look up the people who report to you, add new staff to your own department, and set your team''s punch zone and weekly off days. Limited to your own team.',
     'MEDIUM', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'rbac.access.manage-overrides'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.employee.team.manage'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('DEPT_MANAGER', 'OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- ── 4. SUPER_ADMIN read-only gaps ───────────────────────────────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('settings.read'), ('workspace.modules.read')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code = 'SUPER_ADMIN'
   AND EXISTS (SELECT 1 FROM rbac.permissions x WHERE x.code = p.code)
ON CONFLICT DO NOTHING;
