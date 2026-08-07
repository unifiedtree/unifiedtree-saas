"""
Add reconciliation-tracking columns to platform.subscriptions so the
new hourly reconciliation cron can:
  1. Cheaply pick oldest-un-reconciled rows.
  2. Record the last-observed Razorpay status for ops visibility.
  3. Persist the last error message when Razorpay lookup fails, so a
     permanently-broken subscription doesn't starve the queue.

Runs as postgres (superuser) — DDL. Flyway is off in prod per
flyway-must-stay-disabled memory; migration scripts live under scripts/
and are applied manually via psycopg2 over the Cloud SQL Auth Proxy.

Idempotent: ADD COLUMN IF NOT EXISTS everywhere. Safe to re-run.
"""
import os
import psycopg2

PROXY_HOST = os.getenv("PROXY_HOST", "127.0.0.1")
PROXY_PORT = int(os.getenv("PROXY_PORT", "15432"))
DB_NAME    = os.getenv("DB_NAME", "railway")
DB_USER    = os.getenv("DB_USER", "postgres")
DB_PASS    = os.environ["PGPASSWORD"]

DDL = """
BEGIN;

ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS last_reconciled_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_razorpay_status VARCHAR(32),
    ADD COLUMN IF NOT EXISTS reconcile_error      TEXT;

-- Partial index so the cron's "pick oldest N reconcilable rows" query is
-- O(log n) on the subset that actually needs reconciling. NULLS FIRST puts
-- never-reconciled rows at the head of the queue.
CREATE INDEX IF NOT EXISTS ix_subscriptions_last_reconciled
    ON platform.subscriptions (last_reconciled_at NULLS FIRST)
    WHERE status IN ('ACTIVE','TRIALING','PAST_DUE','HALTED');

COMMIT;
"""

VERIFY = """
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'platform'
   AND table_name   = 'subscriptions'
   AND column_name IN ('last_reconciled_at', 'last_razorpay_status', 'reconcile_error')
 ORDER BY column_name;
"""


def main():
    conn = psycopg2.connect(
        host=PROXY_HOST, port=PROXY_PORT,
        dbname=DB_NAME, user=DB_USER, password=DB_PASS,
        connect_timeout=10,
    )
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
        print("DDL committed.")
        with conn.cursor() as cur:
            cur.execute(VERIFY)
            for name, dtype in cur.fetchall():
                print(f"  {name:28s} {dtype}")
    except Exception as exc:
        conn.rollback()
        print(f"ROLLBACK: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
