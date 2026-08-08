"""Create notif.milestone_reminder_log.

Why a log table at all: Cloud Run runs more than one instance, and @Scheduled
fires on every one of them. Without a dedupe key, a workspace of 200 people
would get two (or five) "Happy birthday" pushes each morning. The unique index
is the arbiter — the job INSERTs first with ON CONFLICT DO NOTHING and only
sends when the insert actually took the row. That makes the send at-most-once
per (employee, kind, day) no matter how many instances race, and it survives a
restart mid-run because the rows already written stay written.

Also doubles as the audit of what was sent, which HR will eventually ask for.

Mirrors notif.device_tokens exactly: postgres owner, RLS with the standard
tenant_id = current_tenant_id() predicate, and CRUD to ut_app + hrms_app.

Idempotent - safe to re-run.
"""
import os
import psycopg2

conn = psycopg2.connect(host=os.getenv("PROXY_HOST", "127.0.0.1"),
                        port=int(os.getenv("PROXY_PORT", "15432")),
                        dbname=os.getenv("DB_NAME", "railway"),
                        user=os.getenv("DB_USER", "postgres"),
                        password=os.environ["PGPASSWORD"], connect_timeout=20)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS notif.milestone_reminder_log (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    uuid NOT NULL,
            employee_id  uuid NOT NULL,
            -- 'BIRTHDAY' | 'WORK_ANNIVERSARY'
            kind         varchar(32) NOT NULL,
            -- the calendar day the milestone fell on, NOT the send timestamp:
            -- that is what makes the unique key mean "once per occurrence".
            occurred_on  date NOT NULL,
            recipients   int  NOT NULL DEFAULT 0,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_reminder_once
            ON notif.milestone_reminder_log (tenant_id, employee_id, kind, occurred_on)
    """)
    # Housekeeping index for the eventual "what did we send in March" question
    # and for any future purge job.
    cur.execute("""
        CREATE INDEX IF NOT EXISTS ix_milestone_reminder_tenant_day
            ON notif.milestone_reminder_log (tenant_id, occurred_on DESC)
    """)

    cur.execute("ALTER TABLE notif.milestone_reminder_log ENABLE ROW LEVEL SECURITY")
    cur.execute("ALTER TABLE notif.milestone_reminder_log FORCE ROW LEVEL SECURITY")
    cur.execute("DROP POLICY IF EXISTS tenant_isolation_milestone_reminder_log "
                "ON notif.milestone_reminder_log")
    cur.execute("""
        CREATE POLICY tenant_isolation_milestone_reminder_log
            ON notif.milestone_reminder_log
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id())
    """)

    for role in ("ut_app", "hrms_app"):
        cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE "
                    f"ON notif.milestone_reminder_log TO {role}")

    conn.commit()
    print("notif.milestone_reminder_log ready (table + unique index + RLS + grants)")

    cur.execute("""
        SELECT c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'notif' AND c.relname = 'milestone_reminder_log'
    """)
    print("  rls=%s force=%s policies=%s" % cur.fetchone())
except Exception:
    conn.rollback()
    raise
finally:
    cur.close()
    conn.close()
