"""
Add the plan_change_requests table + tenant_modules.seats column for the
in-workspace autopay setup flow (Phase 3 of the 2026-08-07 client asks).

Runs as postgres (superuser) — creates the table + owns it, then grants
ut_app the CRUD needed by PlanChangeService.

Flyway is off in prod (per memory flyway-must-stay-disabled). Migration
scripts live under scripts/ and are applied manually via psycopg2 over
the Cloud SQL Auth Proxy (see gcp-db-access-proxy).

Idempotent — safe to re-run:
  * CREATE TABLE IF NOT EXISTS
  * ADD COLUMN IF NOT EXISTS
  * CREATE UNIQUE INDEX IF NOT EXISTS
"""
import os
import psycopg2

PROXY_HOST = os.getenv("PROXY_HOST", "127.0.0.1")
PROXY_PORT = int(os.getenv("PROXY_PORT", "15432"))
DB_NAME    = os.getenv("DB_NAME", "railway")
DB_USER    = os.getenv("DB_USER", "postgres")  # NOT ut_app — this touches DDL
DB_PASS    = os.environ["PGPASSWORD"]          # export via `gcloud secrets versions access ...`

DDL = """
BEGIN;

-- 1. plan_change_requests: pending "add/change modules on this workspace"
--    intents. Mirrors pending_signups but scoped to an EXISTING tenant
--    (so no subdomain / password / account fields; just what modules to
--    activate and at what seat count once the mandate is authorised).
CREATE TABLE IF NOT EXISTS platform.plan_change_requests (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    initiator_account_id    UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    plan_items              JSONB NOT NULL,           -- [{"planKey":"hr-employees","seats":10}, ...]
    billing_cycle           VARCHAR(16) NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
    razorpay_subscription_id VARCHAR(64),
    razorpay_customer_id    VARCHAR(64),
    checkout_short_url      TEXT,
    status                  VARCHAR(24) NOT NULL DEFAULT 'AWAITING_MANDATE'
                              CHECK (status IN ('AWAITING_MANDATE','ACTIVATED','FAILED','CANCELLED','EXPIRED')),
    failure_reason          TEXT,
    expires_at              TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
    activated_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook lookup by Razorpay subscription id needs to be O(1). PARTIAL
-- so cancelled/failed rows don't collide (Razorpay may reissue subscription
-- ids after we've abandoned a row).
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_change_requests_razorpay_subscription_id
  ON platform.plan_change_requests (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_plan_change_requests_tenant_status
  ON platform.plan_change_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS ix_plan_change_requests_expires_at
  ON platform.plan_change_requests (expires_at)
  WHERE status = 'AWAITING_MANDATE';

-- Grants for ut_app (the runtime role). It never issues DDL.
GRANT SELECT, INSERT, UPDATE ON platform.plan_change_requests TO ut_app;

-- 2. tenant_modules.seats: per-module seat count. Populated by the
--    plan-change webhook path (Phase 3) with the seats the admin picked.
--    Existing rows default to 0; the plan-change activation writes the
--    real value on activation.
ALTER TABLE platform.tenant_modules ADD COLUMN IF NOT EXISTS seats INT NOT NULL DEFAULT 0;

COMMIT;
"""

VERIFY = """
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'platform' AND table_name = 'plan_change_requests'
 ORDER BY ordinal_position;
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
        print("DDL committed OK.")

        with conn.cursor() as cur:
            cur.execute(VERIFY)
            print("\nplan_change_requests columns:")
            for name, dtype in cur.fetchall():
                print(f"  {name:<28} {dtype}")

            cur.execute("""
                SELECT column_name, data_type
                  FROM information_schema.columns
                 WHERE table_schema='platform' AND table_name='tenant_modules'
                   AND column_name='seats'
            """)
            row = cur.fetchone()
            if row:
                print(f"\ntenant_modules.seats: {row[1]} (present)")
            else:
                print("\nWARNING: tenant_modules.seats not present — did the ALTER fail?")
    except Exception as exc:
        conn.rollback()
        print(f"ROLLBACK: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
