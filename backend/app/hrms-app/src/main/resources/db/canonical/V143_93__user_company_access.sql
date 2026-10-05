-- V143.93: company access — a role per company (docs/redesign/COMPANY_ACCESS.md).
--
-- Product model (owner-confirmed 6 Oct 2026): one person = one login = one employee record in
-- their main (home) company. Access to any OTHER company of the workspace is a grant with a role
-- for that company ("Company 1: Manager, Company 3: Employee").
--
-- rbac.user_company_access: one row per (person, company, role) granted. The home company is NOT
-- stored here: a person's roles in their home company stay their normal roles (rbac.user_roles),
-- so the two can never disagree. People holding a workspace-wide role (OWNER, SUPER_ADMIN, ADMIN,
-- COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD) and logins with no employee record keep seeing every
-- company, as today, without any row.
--
-- Backfill: none is needed. With no rows, every existing person keeps exactly their access today
-- in their home company (their roles), and workspace-wide people keep every company. The only
-- change is that company-scoped people (Employee, Dept Manager, Manager, custom roles) in a
-- workspace with 2+ companies are limited to their home company until an admin grants more —
-- that comes from the server code, not from this file.
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it), so nothing that
-- exists today changes. Until this file is applied the server treats everyone as having no grants
-- (reads answer "no grants", saving a grant answers FEATURE_NOT_READY). No new permission, so
-- OwnerPermissionInvariantCheck is unaffected. Deleting a person, company or role deletes their rows.
--
-- Numbered 143.93 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks).
-- Production has Flyway OFF: apply by hand, as the table owner (a superuser: row-level security
-- and grants).

CREATE TABLE IF NOT EXISTS rbac.user_company_access (
    tenant_id   UUID         NOT NULL,
    user_id     UUID         NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    company_id  UUID         NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    role_id     UUID         NOT NULL REFERENCES rbac.roles(id) ON DELETE CASCADE,
    granted_by  UUID,
    granted_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_company_access PRIMARY KEY (tenant_id, user_id, company_id, role_id)
);

-- Per-company listing (Roles & Access page, billing counts).
CREATE INDEX IF NOT EXISTS idx_user_company_access_company
    ON rbac.user_company_access (tenant_id, company_id);

COMMENT ON TABLE rbac.user_company_access IS
    'Company access grants (V143.93): a person''s role(s) in a company other than their home company. Home company roles = rbac.user_roles; workspace-wide roles (OWNER, SUPER_ADMIN, ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD) cover every company without rows. JDBC only.';

ALTER TABLE rbac.user_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.user_company_access FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'rbac' AND tablename = 'user_company_access'
                      AND policyname = 'tenant_isolation_user_company_access') THEN
        CREATE POLICY tenant_isolation_user_company_access ON rbac.user_company_access
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON rbac.user_company_access TO ut_app;
    ELSE
        RAISE NOTICE 'V143.93: role ut_app not present — grants skipped';
    END IF;
END $$;
