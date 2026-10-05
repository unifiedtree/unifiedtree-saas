-- V143.89: "Show birthdays to colleagues", a per-company switch in HR configuration ->
-- Celebrations. ON by default, which is how every company works today.
--
-- Why. The owner asked for the option (5 Oct 2026): "provide that option, default should NOT
-- hide". Some companies don't want colleagues to see each other's birthdays.
--
-- settings.celebration_settings: one row per company, saved from HR configuration by whoever
-- may edit it (settings.hrconfig.write; no new permission). No row means ON.
--   * show_birthdays  ON: birthdays show as today (Celebrations card and page, Home's Upcoming
--                     events, never with the year). OFF: nobody in that company sees colleagues'
--                     birthdays there and nobody can send birthday wishes (V143.84); work
--                     anniversaries and new joiners still show. The person's own birthday
--                     greeting and the heads-up to their manager and HR are not changed.
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it, and nothing is
-- added to settings.hr_configuration, which one does), so nothing that exists today changes.
-- Until this file is applied every company shows birthdays exactly as today, and the setting's
-- endpoints answer 503 FEATURE_NOT_READY (HR configuration says it isn't switched on yet).
-- No new permission, so OwnerPermissionInvariantCheck is unaffected.
--
-- Numbered 143.89 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks). Production has
-- Flyway OFF: apply by hand, as the table owner (a superuser: row-level security and grants).

CREATE TABLE IF NOT EXISTS settings.celebration_settings (
    tenant_id           UUID          NOT NULL,
    company_id          UUID          NOT NULL,
    show_birthdays      BOOLEAN       NOT NULL DEFAULT TRUE,
    updated_by_user_id  UUID,
    updated_by_name     VARCHAR(200),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_celebration_settings PRIMARY KEY (tenant_id, company_id)
);

COMMENT ON TABLE settings.celebration_settings IS
    'Celebrations settings per company (V143.89): whether colleagues see each other''s birthdays (default on). No row = on. JDBC only.';

ALTER TABLE settings.celebration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.celebration_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'settings' AND tablename = 'celebration_settings'
                      AND policyname = 'tenant_isolation_celebration_settings') THEN
        CREATE POLICY tenant_isolation_celebration_settings ON settings.celebration_settings
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA settings TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON settings.celebration_settings TO ut_app;
    ELSE
        RAISE NOTICE 'V143.89: role ut_app not present — grants skipped';
    END IF;
END $$;
