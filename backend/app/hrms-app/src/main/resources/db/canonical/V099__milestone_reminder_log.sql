-- ============================================================================
-- V099 - notif.milestone_reminder_log — birthday / work-anniversary dedupe
--        (Audit Bundle B9, 2026-08-14)
-- ----------------------------------------------------------------------------
-- Finding addressed:
--
--   B9-5  milestone-reminder-multi-instance-dupes
--         Cloud Run runs more than one instance and @Scheduled fires on
--         every one of them. Without a dedupe key, a workspace of 200
--         people would get two (or five) "Happy birthday" pushes each
--         morning. The unique index on (tenant_id, employee_id, kind,
--         occurred_on) is the arbiter: the job INSERTs first with
--         ON CONFLICT DO NOTHING and only sends when the insert actually
--         took the row. That makes the send at-most-once per (employee,
--         kind, day) no matter how many instances race, and it survives
--         a restart mid-run because the rows already written stay written.
--
--         Also doubles as the audit of what was sent, which HR will
--         eventually ask for.
--
--         Mirrors notif.device_tokens exactly: postgres owner, RLS with
--         the standard tenant_id = current_tenant_id() predicate, and
--         CRUD grants to ut_app + hrms_app.
--
-- ----------------------------------------------------------------------------
-- APPLICATION MODEL:
--   Flyway is disabled on the live backend. This file is a canonical
--   mirror of scripts/add_milestone_reminder_log.py; the operator MUST
--   APPLY IT MANUALLY VIA PSYCOPG in a quiet window (SET LOCAL
--   lock_timeout='2s' recommended) — see scripts/apply_v097_v098_v099.py.
--
--   Idempotent: every object is guarded IF NOT EXISTS / DROP POLICY IF
--   EXISTS. Safe to re-run.
--
--   Rollback (order matters — drop grants implicit with the table):
--     DROP TABLE IF EXISTS notif.milestone_reminder_log CASCADE;
-- ============================================================================

CREATE TABLE IF NOT EXISTS notif.milestone_reminder_log (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid        NOT NULL,
    employee_id  uuid        NOT NULL,
    -- 'BIRTHDAY' | 'WORK_ANNIVERSARY'
    kind         varchar(32) NOT NULL,
    -- The calendar day the milestone fell on, NOT the send timestamp:
    -- that is what makes the unique key mean "once per occurrence".
    occurred_on  date        NOT NULL,
    recipients   int         NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Dedupe arbiter — INSERT ... ON CONFLICT DO NOTHING relies on this.
CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_reminder_once
    ON notif.milestone_reminder_log (tenant_id, employee_id, kind, occurred_on);

-- Housekeeping index for the eventual "what did we send in March" question
-- and for any future purge job.
CREATE INDEX IF NOT EXISTS ix_milestone_reminder_tenant_day
    ON notif.milestone_reminder_log (tenant_id, occurred_on DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE notif.milestone_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.milestone_reminder_log FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_milestone_reminder_log
    ON notif.milestone_reminder_log;
CREATE POLICY tenant_isolation_milestone_reminder_log
    ON notif.milestone_reminder_log
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Grants — mirror notif.device_tokens (ut_app + hrms_app) ────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notif.milestone_reminder_log TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notif.milestone_reminder_log TO hrms_app;
    END IF;
END $$;

-- ── Verification log ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_rls      BOOLEAN;
    v_force    BOOLEAN;
    v_policies INT;
BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
      INTO v_rls, v_force, v_policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'notif' AND c.relname = 'milestone_reminder_log';
    RAISE NOTICE 'V099 verify: notif.milestone_reminder_log rls=% force=% policies=%',
        v_rls, v_force, v_policies;
END $$;
