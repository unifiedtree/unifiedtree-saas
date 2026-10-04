-- V143.72: punch-in alerts. When someone punches in, the people who should know get an
-- alert in the app and on their phone with the time, how they punched in and exactly
-- where (the office zone, or how far outside it, the coordinates and a map link).
--
-- Why. The owner asked (4 Oct 2026): "the admin or the person who the admin assigns
-- (manager, supervisor) must receive the notification of punch in with the exact
-- location". Until now nothing told anyone about a punch-in; the only attendance alert
-- went to the employee (CHECKIN_REMINDER).
--
-- attendance.punch_alert_settings: who gets the alerts, one row per company, edited in
-- HR configuration -> Punch-in alerts by whoever may edit attendance settings
-- (settings.hrconfig.write or attendance.policy.manage; no new permission):
--   * notify_manager      the person's reporting manager (their department head when they
--                         have none). ON by default.
--   * employee_ids        extra people the company picked (people in that company).
--   * role_ids            everyone in that company holding one of these roles, built-in or
--                         made by the business. None by default.
--   * alert_on            ALL (every punch-in, the default) or LATE_OR_OUTSIDE (only
--                         late punch-ins and punch-ins outside the office).
-- No row means the defaults: the reporting manager, for every punch-in. The person who
-- punched never gets an alert about themself, and nobody gets the same alert twice.
-- HR's manual entries are not punches and send nothing.
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it), so
-- nothing that exists today changes. The alert is sent after the punch commits, on a
-- background thread, and a failure is logged, never thrown: a punch can't be slowed
-- down or refused because of it. Until this file is applied the backend sends no punch-in
-- alerts at all and the settings endpoints answer FEATURE_NOT_READY (the section says
-- it isn't switched on yet), so applying this file is what switches the alerts on, with
-- the defaults above, for every company. No grant changes and no new permission, so
-- OwnerPermissionInvariantCheck is unaffected.
--
-- Numbered 143.72 (reserved; V143.69 is the latest on main and Flyway compares versions
-- numerically, so 143.72 sorts after it). Idempotent (IF NOT EXISTS, guarded DO blocks).
-- Production has Flyway OFF: apply by hand, as the table owner (a superuser: row-level
-- security and grants).

CREATE TABLE IF NOT EXISTS attendance.punch_alert_settings (
    tenant_id           UUID          NOT NULL,
    company_id          UUID          NOT NULL,
    notify_manager      BOOLEAN       NOT NULL DEFAULT TRUE,
    employee_ids        UUID[]        NOT NULL DEFAULT '{}',
    role_ids            UUID[]        NOT NULL DEFAULT '{}',
    alert_on            VARCHAR(20)   NOT NULL DEFAULT 'ALL',
    updated_by_user_id  UUID,
    updated_by_name     VARCHAR(200),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_punch_alert_settings PRIMARY KEY (tenant_id, company_id),
    CONSTRAINT ck_punch_alert_settings_alert_on CHECK (alert_on IN ('ALL', 'LATE_OR_OUTSIDE')),
    CONSTRAINT ck_punch_alert_settings_people CHECK (cardinality(employee_ids) <= 50),
    CONSTRAINT ck_punch_alert_settings_roles CHECK (cardinality(role_ids) <= 20)
);

COMMENT ON TABLE attendance.punch_alert_settings IS
    'Who gets punch-in alerts, per company (V143.72): the reporting manager (default on), extra people and roles, every punch-in or only late/outside ones. No row = the defaults. JDBC only.';

ALTER TABLE attendance.punch_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.punch_alert_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'punch_alert_settings'
                      AND policyname = 'tenant_isolation_punch_alert_settings') THEN
        CREATE POLICY tenant_isolation_punch_alert_settings ON attendance.punch_alert_settings
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.punch_alert_settings TO ut_app;
    ELSE
        RAISE NOTICE 'V143.72: role ut_app not present — grants skipped';
    END IF;
END $$;
