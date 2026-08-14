"""Apply canonical migrations V097 + V098 + V099 (Audit Bundle B9).

Flyway is disabled on the live backend (SPRING_FLYWAY_ENABLED=false; ut_app
can't touch flyway_schema_history), so every canonical migration also ships
as a psycopg script that applies the same DDL directly. This one bundles
three independent data-integrity gaps surfaced by Audit Bundle B9:

    V097  audit.events RLS + attendance CHECK constraints
          - ENABLE + FORCE ROW LEVEL SECURITY on audit.events
          - Idempotently (re)create SELECT policy tenant_isolation_audit_read
          - CHECK (status IN ('PENDING','APPROVED','REJECTED')) on
            attendance.regularization_requests
          - CHECK (check_out_at IS NULL OR check_in_at IS NULL
                   OR check_out_at >= check_in_at) on attendance.records

    V098  UNIQUE (program_id, employee_id) on
          learning_mgmt.training_enrollments — prevents double-click / race
          duplicates that inflate the completion-rate dashboard.

    V099  notif.milestone_reminder_log — table + unique-dedupe index + RLS
          + grants. Mirror of scripts/add_milestone_reminder_log.py so the
          canonical/ history captures the DDL.

Idempotent — every statement is guarded IF NOT EXISTS / IF EXISTS. A
mid-flight failure rolls the entire migration back (single transaction).

Each transaction sets `SET LOCAL lock_timeout='2s'` first, so an
ADD CONSTRAINT / CREATE INDEX blocked on a slow reader fails fast (55P03,
lock_not_available) instead of stalling the app connection pool. Re-run
after the blocker clears.

Data pre-checks:
    - V097 attendance.regularization_requests: flags any status value that
      is not in ('PENDING','APPROVED','REJECTED') before the ALTER.
    - V097 attendance.records: flags any row with both timestamps set and
      check_out_at < check_in_at before the ALTER.
    - V098 learning_mgmt.training_enrollments: flags duplicate
      (program_id, employee_id) groups before the UNIQUE index build.

If any pre-check surfaces bad rows, the script prints them and exits 2
WITHOUT taking a lock, so operators can clean up and re-run.

Run once against prod (Cloud SQL Auth Proxy on 127.0.0.1:15432 per memory):
    PGPASSWORD=$(gcloud secrets versions access latest \\
        --secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) \\
        python scripts/apply_v097_v098_v099.py
"""
import os
import sys
import psycopg2
import psycopg2.errors


# ── V097 ────────────────────────────────────────────────────────────────────
DDL_V097 = r"""
-- audit.events RLS
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

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

-- regularization_requests.status CHECK
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
        ALTER TABLE attendance.regularization_requests
            VALIDATE CONSTRAINT ck_regul_status_domain;
    END IF;
END $$;

-- attendance.records checkout-not-before-checkin CHECK
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
"""


# ── V098 ────────────────────────────────────────────────────────────────────
DDL_V098 = r"""
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_enrollments_program_employee
    ON learning_mgmt.training_enrollments (program_id, employee_id);
"""


# ── V099 ────────────────────────────────────────────────────────────────────
DDL_V099 = r"""
CREATE TABLE IF NOT EXISTS notif.milestone_reminder_log (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid        NOT NULL,
    employee_id  uuid        NOT NULL,
    kind         varchar(32) NOT NULL,
    occurred_on  date        NOT NULL,
    recipients   int         NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_reminder_once
    ON notif.milestone_reminder_log (tenant_id, employee_id, kind, occurred_on);

CREATE INDEX IF NOT EXISTS ix_milestone_reminder_tenant_day
    ON notif.milestone_reminder_log (tenant_id, occurred_on DESC);

ALTER TABLE notif.milestone_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif.milestone_reminder_log FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_milestone_reminder_log
    ON notif.milestone_reminder_log;
CREATE POLICY tenant_isolation_milestone_reminder_log
    ON notif.milestone_reminder_log
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notif.milestone_reminder_log TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notif.milestone_reminder_log TO hrms_app;
    END IF;
END $$;
"""


def _precheck(cur) -> None:
    """Refuse to lock a table when data would immediately violate the new
    constraint / index. Prints the offending rows and exits 2 - fix the data
    and re-run.
    """
    # V097-2: regularization status domain
    cur.execute("""
        SELECT id, tenant_id, employee_id, status
          FROM attendance.regularization_requests
         WHERE status IS NULL
            OR status NOT IN ('PENDING','APPROVED','REJECTED')
    """)
    bad = cur.fetchall()
    if bad:
        print(f"ABORT [V097 pre-check]: {len(bad)} regularization row(s) have "
              f"out-of-domain status:")
        for r in bad:
            print(f"  id={r[0]} tenant={r[1]} employee={r[2]} status={r[3]!r}")
        sys.exit(2)

    # V097-3: attendance checkout-before-checkin
    cur.execute("""
        SELECT tenant_id, employee_id, attendance_date, check_in_at, check_out_at
          FROM attendance.records
         WHERE check_in_at  IS NOT NULL
           AND check_out_at IS NOT NULL
           AND check_out_at < check_in_at
    """)
    bad = cur.fetchall()
    if bad:
        print(f"ABORT [V097 pre-check]: {len(bad)} attendance record(s) have "
              f"check_out_at < check_in_at:")
        for r in bad:
            print(f"  tenant={r[0]} employee={r[1]} date={r[2]} "
                  f"in={r[3]} out={r[4]}")
        sys.exit(2)

    # V098: training enrollment duplicate (program, employee)
    cur.execute("""
        SELECT program_id, employee_id, count(*)
          FROM learning_mgmt.training_enrollments
         GROUP BY program_id, employee_id
        HAVING count(*) > 1
    """)
    dupes = cur.fetchall()
    if dupes:
        print(f"ABORT [V098 pre-check]: {len(dupes)} duplicate "
              f"(program_id, employee_id) group(s) in training_enrollments:")
        for r in dupes:
            print(f"  program={r[0]} employee={r[1]} count={r[2]}")
        sys.exit(2)


def _apply(cur, label: str, ddl: str) -> None:
    print(f"→ Applying {label} (lock_timeout=2s) ...")
    # SET LOCAL is scoped to the current transaction (see PostgreSQL docs).
    # The outer `with conn:` from main() wraps ALL three applies in a single
    # transaction, so setting it once at the top of _apply covers each block.
    cur.execute("SET LOCAL lock_timeout = '2s'")
    try:
        cur.execute(ddl)
    except psycopg2.errors.LockNotAvailable as e:
        print(f"ERROR: {label} could not acquire lock in 2s — {e}")
        print("Wait for the blocker to clear and re-run.")
        raise
    print(f"  OK — {label} applied.")


def _verify(cur) -> None:
    # V097 verification
    cur.execute("""
        SELECT relrowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'audit' AND c.relname = 'events'
    """)
    audit_rls = cur.fetchone()[0]
    assert audit_rls, "audit.events RLS is not enabled after V097"

    cur.execute("""
        SELECT count(*) FROM pg_policies
         WHERE schemaname = 'audit' AND tablename = 'events'
           AND policyname = 'tenant_isolation_audit_read'
    """)
    assert cur.fetchone()[0] == 1, "tenant_isolation_audit_read missing after V097"

    cur.execute("""
        SELECT count(*) FROM pg_constraint
         WHERE conname = 'ck_regul_status_domain'
           AND conrelid = 'attendance.regularization_requests'::regclass
    """)
    assert cur.fetchone()[0] == 1, "ck_regul_status_domain missing after V097"

    cur.execute("""
        SELECT count(*) FROM pg_constraint
         WHERE conname = 'ck_attendance_checkout_gte_checkin'
           AND conrelid = 'attendance.records'::regclass
    """)
    assert cur.fetchone()[0] == 1, "ck_attendance_checkout_gte_checkin missing after V097"

    # V098 verification
    cur.execute("""
        SELECT count(*) FROM pg_indexes
         WHERE schemaname = 'learning_mgmt'
           AND tablename  = 'training_enrollments'
           AND indexname  = 'uq_training_enrollments_program_employee'
    """)
    assert cur.fetchone()[0] == 1, "uq_training_enrollments_program_employee missing after V098"

    # V099 verification
    cur.execute("""
        SELECT c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'notif' AND c.relname = 'milestone_reminder_log'
    """)
    row = cur.fetchone()
    assert row is not None, "notif.milestone_reminder_log missing after V099"
    rls, force, policies = row
    assert rls,     "notif.milestone_reminder_log RLS not enabled after V099"
    assert force,   "notif.milestone_reminder_log RLS not FORCED after V099"
    assert policies >= 1, "notif.milestone_reminder_log has no policies after V099"

    print("OK — verification passed: V097 + V098 + V099 all present.")


def main() -> None:
    pw = os.environ.get("PGPASSWORD")
    if not pw:
        raise SystemExit(
            "PGPASSWORD not set. Run:\n"
            "  PGPASSWORD=$(gcloud secrets versions access latest "
            "--secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) "
            "python scripts/apply_v097_v098_v099.py"
        )
    host = os.environ.get("PGHOST", "127.0.0.1")
    port = int(os.environ.get("PGPORT", "15432"))
    user = os.environ.get("PGUSER", "postgres")
    db = os.environ.get("PGDATABASE", "postgres")

    print(f"Connecting to {user}@{host}:{port}/{db} ...")
    conn = psycopg2.connect(
        host=host, port=port, user=user, password=pw, dbname=db,
        connect_timeout=20,
    )
    try:
        # `with conn:` opens a single transaction spanning all three applies.
        # On exception the whole thing rolls back — the three migrations
        # succeed or fail together.
        with conn:
            with conn.cursor() as cur:
                _precheck(cur)
                _apply(cur, "V097 (audit RLS + attendance/regul CHECKs)", DDL_V097)
                _apply(cur, "V098 (training_enrollments UNIQUE)",           DDL_V098)
                _apply(cur, "V099 (milestone_reminder_log)",                DDL_V099)
                _verify(cur)
        print("OK — V097 + V098 + V099 applied and committed.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
