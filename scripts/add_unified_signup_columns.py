"""
Schema additions for the unified-signup + hard-gate autopay flow (2026-08).

All additive except one CHECK-constraint replacement on
platform.subscriptions.status that widens the allowed enum to cover the
new states this flow introduces (PENDING_MANDATE, TRIALING, GRACE).

Idempotent (IF NOT EXISTS everywhere). Runs as the postgres superuser
because ut_app is not owner of platform.subscriptions or platform.tenants.
Both the ALTERs and the two new tables get explicit GRANTs to ut_app at
the end so the app can read/write them at runtime.

New / changed:

  platform.subscriptions
    - REPLACE status CHECK to allow PENDING_MANDATE|TRIALING|GRACE alongside
      the existing ACTIVE|PAST_DUE|HALTED|COMPLETED|CANCELLED|PAUSED|EXPIRED
    - ADD grace_until timestamptz        (7-day grace window after HALTED)
    - ADD pending_signup_id uuid         (link back to the signup intent)
    - INDEX ix_subscriptions_razorpay_subscription_id (webhook lookup key)

  platform.tenants
    - ADD pan, gstin, address_line1, address_line2, city, state,
      postal_code (all nullable — filled at signup OR later in workspace
      settings; soft-validated on the client, never blocked)

  platform.razorpay_webhook_events
    - ADD processed_at, process_status ('RECEIVED'|'DONE'|'FAILED'),
      process_error text  — so the retry sweep can find stuck events

  NEW platform.pending_signups
    - Reservation-cum-staging row written BEFORE we open Razorpay
      checkout. Holds every field needed to provision the workspace,
      keyed by razorpay_subscription_id. Webhook (subscription.
      authenticated for TRIAL; subscription.activated/charged for PAID)
      reads it and hands to MandateProvisioningService which creates the
      real workspace atomically. Then the row is marked PROVISIONED.
      Unique partial index on subdomain WHERE status='AWAITING_MANDATE'
      blocks two concurrent signups from claiming the same subdomain.
"""
import subprocess, psycopg2

pw = subprocess.check_output(
    "gcloud secrets versions access latest --secret=POSTGRES_ROOT_PASSWORD --project=unifiedtree-445cd",
    shell=True).decode().strip()

conn = psycopg2.connect(host="127.0.0.1", port=15432, dbname="railway",
                        user="postgres", password=pw, connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

STATEMENTS = [
    # ---------------- platform.subscriptions ----------------
    "ALTER TABLE platform.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;",

    """
    ALTER TABLE platform.subscriptions ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN (
          'PENDING_MANDATE','TRIALING','ACTIVE','PAST_DUE',
          'HALTED','GRACE','COMPLETED','CANCELLED','PAUSED','EXPIRED'
      ));
    """,

    "ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS grace_until       TIMESTAMPTZ;",
    "ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS pending_signup_id UUID;",

    # UNIQUE (partial) — MandateProvisioningService uses ON CONFLICT on this
    # index for idempotency of the platform.subscriptions insert when
    # duplicate webhook events fire for the same Razorpay subscription.
    "DROP INDEX IF EXISTS platform.ix_subscriptions_razorpay_subscription_id;",
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_subscriptions_razorpay_subscription_id
      ON platform.subscriptions(razorpay_subscription_id)
      WHERE razorpay_subscription_id IS NOT NULL;
    """,

    # ---------------- platform.tenants (optional company details) ----------------
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS pan            VARCHAR(20);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS gstin          VARCHAR(20);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line1  VARCHAR(255);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line2  VARCHAR(255);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS city           VARCHAR(100);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS state          VARCHAR(100);",
    "ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS postal_code    VARCHAR(20);",

    # ---------------- platform.razorpay_webhook_events (retry tracking) ----------------
    "ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS processed_at   TIMESTAMPTZ;",
    "ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS process_status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED';",
    "ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS process_error  TEXT;",
    """
    CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_events_status
      ON platform.razorpay_webhook_events(process_status)
      WHERE process_status <> 'DONE';
    """,

    # ---------------- NEW platform.pending_signups ----------------
    """
    CREATE TABLE IF NOT EXISTS platform.pending_signups (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Which flow the customer chose
        mode                     VARCHAR(16) NOT NULL CHECK (mode IN ('TRIAL','PAID')),

        -- Signup intent (all pre-hashed / pre-validated by the endpoint)
        account_id               UUID,                       -- present if the caller was already signed in
        email                    VARCHAR(255) NOT NULL,
        password_hash            VARCHAR(255),               -- null when account_id present (existing account)
        phone                    VARCHAR(20),
        admin_name               VARCHAR(150) NOT NULL,
        company_name             VARCHAR(150) NOT NULL,
        subdomain                VARCHAR(63)  NOT NULL,

        -- Locale / meta
        country                  VARCHAR(50),
        timezone                 VARCHAR(50),
        currency                 VARCHAR(10) DEFAULT 'INR',
        language                 VARCHAR(20),
        primary_interest         VARCHAR(100),

        -- Plan selection
        plan_keys                TEXT[] NOT NULL,
        seats                    INT    NOT NULL DEFAULT 1,
        billing_cycle            VARCHAR(16) NOT NULL DEFAULT 'monthly'
                                    CHECK (billing_cycle IN ('monthly','yearly')),

        -- Optional company / tax details (mirrored to tenants on provision)
        pan                      VARCHAR(20),
        gstin                    VARCHAR(20),
        address_line1            VARCHAR(255),
        address_line2            VARCHAR(255),
        city                     VARCHAR(100),
        state                    VARCHAR(100),
        postal_code              VARCHAR(20),

        -- Razorpay linkage
        razorpay_subscription_id VARCHAR(64) NOT NULL UNIQUE,
        razorpay_customer_id     VARCHAR(64),
        razorpay_short_url       TEXT,

        -- Lifecycle
        status                   VARCHAR(24) NOT NULL DEFAULT 'AWAITING_MANDATE'
                                    CHECK (status IN ('AWAITING_MANDATE','PROVISIONED','FAILED','EXPIRED','CANCELLED')),
        tenant_id                UUID,                       -- filled by the webhook once workspace is provisioned
        provisioned_at           TIMESTAMPTZ,
        failed_at                TIMESTAMPTZ,
        failure_reason           TEXT,
        expires_at               TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
        created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,

    # Only one signup at a time may reserve a given subdomain; once
    # provisioned/failed/expired/cancelled the reservation releases.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_signups_subdomain_active
      ON platform.pending_signups(lower(subdomain))
      WHERE status = 'AWAITING_MANDATE';
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_pending_signups_status
      ON platform.pending_signups(status)
      WHERE status = 'AWAITING_MANDATE';
    """,

    # ---------------- Grants ----------------
    "GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups TO ut_app;",
]

print("Applying unified-signup schema...")
for i, sql in enumerate(STATEMENTS, 1):
    first = sql.strip().splitlines()[0][:70]
    print(f"  [{i}/{len(STATEMENTS)}] {first}...")
    cur.execute(sql)

conn.commit()
print("\nCOMMITTED.")

# ---------------- Verification ----------------
print("\n=== platform.subscriptions status CHECK now allows: ===")
cur.execute("""
    SELECT pg_get_constraintdef(oid)
      FROM pg_constraint
     WHERE conname = 'subscriptions_status_check';
""")
print(f"  {cur.fetchone()[0]}")

print("\n=== new columns on platform.subscriptions ===")
cur.execute("""
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='subscriptions'
       AND column_name IN ('grace_until','pending_signup_id')
     ORDER BY column_name;
""")
for r in cur.fetchall(): print(f"  {r[0]:<20} {r[1]}")

print("\n=== new columns on platform.tenants ===")
cur.execute("""
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='tenants'
       AND column_name IN ('pan','gstin','address_line1','address_line2','city','state','postal_code')
     ORDER BY column_name;
""")
for r in cur.fetchall(): print(f"  {r[0]:<18} {r[1]}")

print("\n=== new columns on platform.razorpay_webhook_events ===")
cur.execute("""
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='razorpay_webhook_events'
       AND column_name IN ('processed_at','process_status','process_error')
     ORDER BY column_name;
""")
for r in cur.fetchall(): print(f"  {r[0]:<18} {r[1]}")

print("\n=== platform.pending_signups columns ===")
cur.execute("""
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='pending_signups'
     ORDER BY ordinal_position;
""")
for r in cur.fetchall(): print(f"  {r[0]:<26} {r[1]}")

print("\n=== ut_app grants on pending_signups ===")
cur.execute("""
    SELECT privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='platform' AND table_name='pending_signups' AND grantee='ut_app'
     ORDER BY privilege_type;
""")
print(f"  {[r[0] for r in cur.fetchall()]}")

conn.close()
print("\nDone.")
