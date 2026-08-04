"""
Autopay schema additions on platform.

Idempotent (uses IF NOT EXISTS). Safe to re-run. Does NOT touch tenant status
or any existing column — grace-period read-only state is tracked on the
subscription itself (halted_at + 7-day elapsed check) rather than by adding
a new tenant.status value that would require a CHECK-constraint migration.

Adds:
  - 6 autopay columns on platform.subscriptions
  - 2 partial indexes
  - platform.razorpay_plans   — mapping (module_key, billing_cycle) -> Razorpay plan id
  - platform.razorpay_webhook_events  — idempotency ledger so a replayed
    webhook can't double-charge the ledger
"""
import subprocess, psycopg2

pw = subprocess.check_output(
    "gcloud secrets versions access latest --secret=DB_PASSWORD --project=unifiedtree-445cd",
    shell=True).decode().strip()

conn = psycopg2.connect(host="127.0.0.1", port=15432, dbname="railway",
                        user="ut_app", password=pw, connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

STATEMENTS = [
    # 1. autopay columns on subscriptions
    """
    ALTER TABLE platform.subscriptions
      ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS razorpay_plan_id         VARCHAR(64),
      ADD COLUMN IF NOT EXISTS next_charge_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS halted_at                TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS auto_renew               BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS payment_method           VARCHAR(32);
    """,
    # 2. indexes
    """
    CREATE INDEX IF NOT EXISTS ix_subscriptions_razorpay_sub
      ON platform.subscriptions(razorpay_subscription_id)
      WHERE razorpay_subscription_id IS NOT NULL;
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_subscriptions_halted_at
      ON platform.subscriptions(halted_at)
      WHERE halted_at IS NOT NULL;
    """,
    # 3. razorpay_plans mapping table
    """
    CREATE TABLE IF NOT EXISTS platform.razorpay_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_key        VARCHAR(64)  NOT NULL,
      billing_cycle     VARCHAR(16)  NOT NULL,   -- 'MONTHLY' | 'ANNUAL'
      razorpay_plan_id  VARCHAR(64)  NOT NULL,
      unit_price_paise  BIGINT       NOT NULL,
      currency          VARCHAR(8)   NOT NULL DEFAULT 'INR',
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
      UNIQUE (module_key, billing_cycle)
    );
    """,
    # 4. webhook idempotency ledger
    """
    CREATE TABLE IF NOT EXISTS platform.razorpay_webhook_events (
      event_id         VARCHAR(128) PRIMARY KEY,
      event_type       VARCHAR(64)  NOT NULL,
      subscription_id  VARCHAR(64),
      payload          JSONB,
      received_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_sub
      ON platform.razorpay_webhook_events(subscription_id)
      WHERE subscription_id IS NOT NULL;
    """,
]

print("Applying autopay schema additions...")
for i, sql in enumerate(STATEMENTS, 1):
    print(f"  [{i}/{len(STATEMENTS)}] {sql.strip().splitlines()[0][:70]}...")
    cur.execute(sql)

conn.commit()
print("\nCOMMITTED.")

# Verification
print("\n=== new subscription columns ===")
cur.execute("""
    SELECT column_name, data_type, column_default
      FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='subscriptions'
       AND column_name IN ('razorpay_subscription_id','razorpay_plan_id',
                            'next_charge_at','halted_at','auto_renew','payment_method')
     ORDER BY column_name;
""")
for r in cur.fetchall():
    print(f"  {r[0]:<28} {r[1]:<25} default={r[2]}")

print("\n=== new tables ===")
cur.execute("""
    SELECT tablename FROM pg_tables
     WHERE schemaname='platform'
       AND tablename IN ('razorpay_plans','razorpay_webhook_events')
     ORDER BY tablename;
""")
for r in cur.fetchall():
    print(f"  platform.{r[0]}")

conn.close()
print("\nDone.")
