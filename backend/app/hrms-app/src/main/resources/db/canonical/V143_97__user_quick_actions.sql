-- V143.97: quick-action customisation (audit G-59, contract BW-112).
--
-- "Customise" on the Dashboard and Home quick actions: a person picks and orders up to 6 of the actions they are
-- allowed, saved per person on the server so the website and the phone app show the same ones. No row = the
-- default set (today's tiles, today's order); "Reset to default" deletes the row.
--
-- hrms.user_dashboard_prefs: one row per (person, surface). surface = 'dashboard' (the admin dashboard) or 'home'
-- (the self-service Home). quick_actions = the picked tile keys, in order (1 to 6, unique; checked by the server).
-- Read and written by QuickActionsController (GET/PUT /v1/me/quick-actions and /v1/me/dashboard/quick-actions).
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it; nothing is added to
-- auth.user_credentials), so nothing that exists today changes. Until this file is applied the server answers
-- GET with { available: false } (the default tiles, Customise hidden) and PUT with FEATURE_NOT_READY. No new
-- permission (the caller's own row only, isAuthenticated()), so OwnerPermissionInvariantCheck is unaffected.
-- Deleting a login deletes its rows.
--
-- Numbered 143.97 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks).
-- Production has Flyway OFF: apply by hand, as the table owner (a superuser: row-level security and grants).

CREATE TABLE IF NOT EXISTS hrms.user_dashboard_prefs (
    tenant_id      UUID         NOT NULL,
    user_id        UUID         NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    surface        VARCHAR(20)  NOT NULL,
    quick_actions  TEXT[]       NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_dashboard_prefs PRIMARY KEY (tenant_id, user_id, surface),
    CONSTRAINT ck_user_dashboard_prefs_surface CHECK (surface IN ('dashboard', 'home')),
    CONSTRAINT ck_user_dashboard_prefs_count CHECK (cardinality(quick_actions) BETWEEN 1 AND 6)
);

COMMENT ON TABLE hrms.user_dashboard_prefs IS
    'Quick-action customisation (V143.97, G-59): the tiles a person picked for the Dashboard or Home, in order. No row = the default tiles. JDBC only.';

ALTER TABLE hrms.user_dashboard_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.user_dashboard_prefs FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'user_dashboard_prefs'
                      AND policyname = 'tenant_isolation_user_dashboard_prefs') THEN
        CREATE POLICY tenant_isolation_user_dashboard_prefs ON hrms.user_dashboard_prefs
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.user_dashboard_prefs TO ut_app;
    ELSE
        RAISE NOTICE 'V143.97: role ut_app not present — grants skipped';
    END IF;
END $$;
