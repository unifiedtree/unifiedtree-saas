-- ============================================================================
-- V097 - audit.events RLS + attendance data-integrity CHECK constraints
--        (Audit Bundle B9, 2026-08-14)
-- ----------------------------------------------------------------------------
-- Findings addressed (B9 - data-integrity gaps):
--
--   B9-1  audit.events-rls-not-enforced
--         ENABLE + FORCE ROW LEVEL SECURITY was assumed in V091 but never
--         actually toggled on the live table (the DBA who pre-created the
--         table left RLS off and V091 only touched policies). Any Java
--         reader with a valid app.tenant_id GUC that ran a raw SELECT with
--         no tenant filter has been reading every tenant's audit trail.
--         Re-enable RLS and idempotently (re)create the SELECT policy
--         tenant_isolation_audit_read so the read side is scoped.
--
--   B9-2  regularization-status-unconstrained
--         attendance.regularization_requests.status is VARCHAR(20) with no
--         CHECK. A rogue write of status='approve' (lowercase) sneaks past
--         the Java enum in native SQL / test fixtures and then breaks the
--         approver dashboard filter which only recognises the canonical
--         upper-case tokens. Lock the domain.
--
--   B9-3  attendance-checkout-before-checkin
--         attendance.records has no CHECK that check_out_at >= check_in_at.
--         A timezone bug or a manual back-fill can produce negative-duration
--         rows which silently blow up payroll's hours-worked calculation.
--         Guard with a NULL-tolerant CHECK (both NULLs and single-sided
--         punches are legal - only a fully-populated pair must be ordered).
--
-- ----------------------------------------------------------------------------
-- APPLICATION MODEL:
--   Flyway is disabled on the live backend (SPRING_FLYWAY_ENABLED=false;
--   ut_app cannot touch flyway_schema_history). This file lives in canonical/
--   for the record of intent, but the operator MUST APPLY IT MANUALLY VIA
--   PSYCOPG in a quiet window — see scripts/apply_v097_v098_v099.py.
--
--   Recommended: SET LOCAL lock_timeout='2s' before every ALTER so an
--   ADD CONSTRAINT waiting on a slow reader fails fast instead of stalling
--   the connection pool. The apply script sets this per transaction.
--
--   Rollback: every object is guarded IF EXISTS / IF NOT EXISTS so a re-run
--   is a no-op. To back out:
--     ALTER TABLE audit.events                       DISABLE ROW LEVEL SECURITY;
--     DROP POLICY IF EXISTS tenant_isolation_audit_read ON audit.events;
--     ALTER TABLE attendance.regularization_requests DROP CONSTRAINT IF EXISTS ck_regul_status_domain;
--     ALTER TABLE attendance.records                 DROP CONSTRAINT IF EXISTS ck_attendance_checkout_gte_checkin;
-- ============================================================================

-- ── B9-1: audit.events — RLS + tenant-scoped SELECT policy ─────────────────
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS; guard by name in pg_policies.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'audit'
           AND tablename  = 'events'
           AND policyname = 'tenant_isolation_audit_read'
    ) THEN
        CREATE POLICY tenant_isolation_audit_read
            ON audit.events
            FOR SELECT
            USING (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── B9-2: attendance.regularization_requests.status domain lock ────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'ck_regul_status_domain'
           AND conrelid = 'attendance.regularization_requests'::regclass
    ) THEN
        ALTER TABLE attendance.regularization_requests
            ADD CONSTRAINT ck_regul_status_domain
                CHECK (status IN ('PENDING','APPROVED','REJECTED')) NOT VALID;
        -- Validate immediately - the table is small and the default is
        -- 'PENDING'; any pre-existing out-of-domain row will surface as
        -- 23514 (check_violation) here rather than during the next write.
        ALTER TABLE attendance.regularization_requests
            VALIDATE CONSTRAINT ck_regul_status_domain;
    END IF;
END $$;

-- ── B9-3: attendance.records checkout-not-before-checkin ───────────────────
-- Both timestamps are nullable (single-sided punches are legal until the
-- day closes) so we only enforce ordering when both sides are set.
-- attendance.records is a partitioned table; ADD CONSTRAINT propagates to
-- every partition automatically.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'ck_attendance_checkout_gte_checkin'
           AND conrelid = 'attendance.records'::regclass
    ) THEN
        ALTER TABLE attendance.records
            ADD CONSTRAINT ck_attendance_checkout_gte_checkin
                CHECK (check_out_at IS NULL
                       OR check_in_at IS NULL
                       OR check_out_at >= check_in_at) NOT VALID;
        ALTER TABLE attendance.records
            VALIDATE CONSTRAINT ck_attendance_checkout_gte_checkin;
    END IF;
END $$;

-- ── Verification log ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_audit_rls           BOOLEAN;
    v_audit_read_policy   INT;
    v_regul_ck            INT;
    v_att_ck              INT;
BEGIN
    SELECT relrowsecurity INTO v_audit_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'audit' AND c.relname = 'events';

    SELECT count(*) INTO v_audit_read_policy
      FROM pg_policies
     WHERE schemaname = 'audit' AND tablename = 'events'
       AND policyname = 'tenant_isolation_audit_read';

    SELECT count(*) INTO v_regul_ck
      FROM pg_constraint
     WHERE conname = 'ck_regul_status_domain'
       AND conrelid = 'attendance.regularization_requests'::regclass;

    SELECT count(*) INTO v_att_ck
      FROM pg_constraint
     WHERE conname = 'ck_attendance_checkout_gte_checkin'
       AND conrelid = 'attendance.records'::regclass;

    RAISE NOTICE 'V097 verify: audit.events.rls=%, audit read policy=%, regul CK=%, attendance CK=%',
        v_audit_rls, v_audit_read_policy, v_regul_ck, v_att_ck;
END $$;
