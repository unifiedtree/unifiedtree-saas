-- ============================================================================
-- V044 - Probation: per-tenant reminder config + reminder dedup log
-- ----------------------------------------------------------------------------
-- Both tables are tenant-owned and RLS-isolated (current_tenant_id() reads
-- app.tenant_id). The daily scan job binds tenant context per-tenant and dedups
-- reminders via the UNIQUE constraint on the log.
--
-- NOTE: the soft-delete flag on hrms.employees is `is_active` (there is NO
-- deleted_at column). The DB role is `hrms_app` (there is NO `app_user`).
-- ============================================================================

-- ── Per-tenant probation policy ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.probation_config (
    tenant_id              UUID         PRIMARY KEY,
    reminder_days_before   INT          NOT NULL DEFAULT 7
                           CHECK (reminder_days_before BETWEEN 1 AND 90),
    auto_extend_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
    auto_extend_days       INT          NOT NULL DEFAULT 90,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE hrms.probation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.probation_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_probation_config ON hrms.probation_config;
CREATE POLICY tenant_isolation_probation_config ON hrms.probation_config
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Reminder dedup log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.probation_reminder_log (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    employee_id         UUID         NOT NULL,
    probation_end_date  DATE         NOT NULL,
    reminder_type       VARCHAR(20)  NOT NULL DEFAULT 'UPCOMING'
                        CHECK (reminder_type IN ('UPCOMING','OVERDUE','FINAL')),
    notified_user_ids   UUID[]       NOT NULL DEFAULT ARRAY[]::UUID[],
    sent_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_probation_reminder
        UNIQUE (tenant_id, employee_id, probation_end_date, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_probation_reminder_emp
    ON hrms.probation_reminder_log(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_probation_reminder_sent
    ON hrms.probation_reminder_log(tenant_id, sent_at DESC);

ALTER TABLE hrms.probation_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.probation_reminder_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_probation_reminder ON hrms.probation_reminder_log;
CREATE POLICY tenant_isolation_probation_reminder ON hrms.probation_reminder_log
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Grants (app_user does NOT exist in this DB — guard it; hrms_app is real) ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.probation_config       TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.probation_reminder_log TO app_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.probation_config       TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.probation_reminder_log TO hrms_app;
    END IF;
END $$;

-- ── Seed default config for existing tenants (reminder_days_before defaults) ─
INSERT INTO hrms.probation_config (tenant_id)
SELECT id FROM platform.tenants
ON CONFLICT (tenant_id) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM hrms.probation_config;
    RAISE NOTICE 'probation_config rows seeded: %', c;
END $$;
