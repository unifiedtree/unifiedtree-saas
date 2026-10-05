-- V143.90: personal pages per role. The workspace owner decides, role by role,
-- whether the people holding it see the personal pages: My work and every "My ..."
-- view inside the modules (My leave, My attendance, My claims, My reviews, My goals,
-- My documents, My letters, My training, My advances, My incentives, My payslips, ...),
-- the "for yourself" quick actions, and the same screens and tabs in the phone app.
--
-- Why. The owner decided on 2026-10-05: "admin also should lose tabs, but the role and
-- permissions should be given for the owner to keep or remove". Until now the web and
-- the app hid those pages from OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN by role name,
-- with no way to change it.
--
-- rbac.role_personal_pages: one row per workspace and role, only where the owner chose
-- something other than the default. Works for built-in roles (rbac.roles.tenant_id IS
-- NULL) too: the row carries the workspace's tenant_id. The rule the server applies
-- (and puts in the sign-in answer and /v1/canonical-auth/me as "personalPages"):
--   * a role's setting = its row here, else OFF for OWNER, SUPER_ADMIN, COMPANY_ADMIN
--     and ADMIN and ON for every other role (built-in or made by the business);
--   * a person sees the personal pages unless they hold at least one role whose setting
--     is OFF.
-- No row anywhere = exactly today's behaviour. Setting a role back to its default
-- removes its row. Only the OWNER changes it (Roles & permissions); the change shows at
-- the person's next sign-in or page reload. It decides what the menus show, not what the
-- server allows: every endpoint keeps checking its permission.
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it), so
-- nothing that exists today changes. Until this file is applied the server answers with
-- the default rule above (the same as today) and saving a setting answers
-- FEATURE_NOT_READY. No grant changes and no new permission, so
-- OwnerPermissionInvariantCheck is unaffected. Deleting a role deletes its row.
--
-- Numbered 143.90 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks).
-- Production has Flyway OFF: apply by hand, as the table owner (a superuser: row-level
-- security and grants).

CREATE TABLE IF NOT EXISTS rbac.role_personal_pages (
    tenant_id   UUID         NOT NULL,
    role_id     UUID         NOT NULL REFERENCES rbac.roles(id) ON DELETE CASCADE,
    enabled     BOOLEAN      NOT NULL,
    updated_by  UUID,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_role_personal_pages PRIMARY KEY (tenant_id, role_id)
);

COMMENT ON TABLE rbac.role_personal_pages IS
    'Personal pages (My work, My leave, My claims, ...) on or off per role, per workspace (V143.90). No row = the default: off for OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN; on for every other role. JDBC only.';

ALTER TABLE rbac.role_personal_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_personal_pages FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'rbac' AND tablename = 'role_personal_pages'
                      AND policyname = 'tenant_isolation_role_personal_pages') THEN
        CREATE POLICY tenant_isolation_role_personal_pages ON rbac.role_personal_pages
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON rbac.role_personal_pages TO ut_app;
    ELSE
        RAISE NOTICE 'V143.90: role ut_app not present — grants skipped';
    END IF;
END $$;
