-- V142 — make the production app role able to use every table, and give
-- shift_change_requests a real migration.
--
-- Found by a production rehearsal on 2026-09-24 (a restored copy of prod with
-- its real grants, V124..V141 applied, then checked as the runtime role).
--
-- 1. Production's backend connects as ut_app (Cloud Run DB_USERNAME=ut_app).
--    Prod has NO `ALTER DEFAULT PRIVILEGES`, so every grant is per table.
--    V130..V141 grant their new tables to hrms_app — an older role the
--    backend does not connect as. Local recovery never noticed because
--    scripts/recovery-runtime-grants.sql grants ut_app on ALL tables. Applied
--    to prod as written, all 12 new tables below would answer "permission
--    denied" and every new page would 500.
--
-- 2. Two tables that ALREADY exist in production were also never granted to
--    ut_app: auth.otp_requests (OtpController / Msg91Client) and
--    platform.seat_overage_notifications (SeatOverageNotifier). Both are used
--    by live code paths.
--
-- 3. attendance.shift_change_requests had no migration at all — only
--    ShiftChangeRequestSchemaBootstrap creates it at startup, and that runs as
--    ut_app, which cannot CREATE, so the failure is a swallowed WARN. Prod has
--    the table (created long ago); every FRESH database (new dev machine,
--    staging, a restore into a new instance) does not, and shift-change
--    requests 500. The DDL below mirrors the bootstrap exactly. The policy is
--    created only if absent — never DROP + CREATE on a live table, which
--    would leave it briefly without tenant isolation.
--
-- Everything here is idempotent. Grants are skipped for a role that does not
-- exist, so fresh/CI databases without ut_app still migrate.

-- ── 3. shift_change_requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.shift_change_requests (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    employee_id               UUID NOT NULL,
    current_shift_policy_id   UUID,
    requested_shift_policy_id UUID NOT NULL,
    reason                    TEXT,
    status                    VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approver_id               UUID,
    decision_note             TEXT,
    decided_at                TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scr_tenant_status ON attendance.shift_change_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_scr_employee      ON attendance.shift_change_requests (tenant_id, employee_id);
ALTER TABLE attendance.shift_change_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'attendance'
           AND tablename  = 'shift_change_requests'
           AND policyname = 'tenant_isolation_scr'
    ) THEN
        CREATE POLICY tenant_isolation_scr ON attendance.shift_change_requests
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 1 + 2. Grants for the runtime role ──────────────────────────────────────
DO $$
DECLARE
    t   TEXT;
    tbl TEXT[] := ARRAY[
        -- new in V130..V141
        'attendance.overtime_decisions',
        'compliance_mgmt.inspection_documents',
        'compliance_mgmt.inspector_sessions',
        'hiring_mgmt.offer_email_attempts',
        'hiring_mgmt.offers',
        'hrms.asset_allocations',
        'hrms.company_notices',
        'hrms.onboarding_assets',
        'hrms.project_tasks',
        'hrms.projects',
        'hrms.time_entries',
        'pli_mgmt.pli_targets',
        -- pre-existing in prod, never granted
        'auth.otp_requests',
        'platform.seat_overage_notifications',
        -- created above
        'attendance.shift_change_requests'
    ];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        RAISE NOTICE 'V142: role ut_app not present — grants skipped';
        RETURN;
    END IF;
    FOREACH t IN ARRAY tbl LOOP
        IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO ut_app', split_part(t, '.', 1));
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO ut_app', t);
        ELSE
            RAISE NOTICE 'V142: % not found — skipped', t;
        END IF;
    END LOOP;
END $$;
