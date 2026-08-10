"""Apply four ADDITIVE DDL changes + one backfill in a single transaction.

Idempotent — every ALTER/CREATE uses IF NOT EXISTS, GRANT is guarded on the
ut_app role existing (fresh CI DBs don't have it).

Run once against prod:
    PGPASSWORD=$(gcloud secrets versions access latest \
        --secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) \
        python scripts/apply_2026_08_10_branding_and_trial.py

Rollback:
    ALTER TABLE platform.plan_change_requests DROP COLUMN start_at;
    ALTER TABLE platform.subscriptions        DROP COLUMN trial_ends_at;
    ALTER TABLE platform.tenants              DROP COLUMN free_trial_used;
    DROP TABLE platform.tenant_branding;
"""
import os
import psycopg2


DDL = """
-- Trial-abuse guard ----------------------------------------------------------

-- Remember the trial start_at on the request so the ledger row inherits it.
ALTER TABLE platform.plan_change_requests
    ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;

-- Expose the trial end on the ledger — the reconciler uses it to cap grace.
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- One-time-trial flag per tenant. Flipped inside PlanChangeService.activate()
-- when a subscription with startAt in the future actually activates. Read in
-- PlanChangeService.create() under the same advisory lock that already guards
-- setup-autopay, so a burst of parallel setup clicks cannot double-grant.
ALTER TABLE platform.tenants
    ADD COLUMN IF NOT EXISTS free_trial_used BOOLEAN NOT NULL DEFAULT FALSE;

-- Per-workspace branding -----------------------------------------------------

CREATE TABLE IF NOT EXISTS platform.tenant_branding (
    tenant_id     UUID PRIMARY KEY REFERENCES platform.tenants(id) ON DELETE CASCADE,
    -- Where the SPA + login page fetch the logo image from. May be a public
    -- R2.dev URL or a presigned URL — either works from the browser.
    logo_url      TEXT,
    -- Optional favicon override — not used by the SPA yet but reserved.
    favicon_url   TEXT,
    -- Optional brand colour, hex with or without alpha (#RRGGBB / #RRGGBBAA).
    primary_color VARCHAR(9)
        CHECK (primary_color IS NULL
               OR primary_color ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'),
    -- Storage-side pointer so we know what to delete when re-uploading.
    logo_r2_key   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by    UUID
);

-- Grant to ut_app only if the role exists — fresh dev DBs don't have it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform.tenant_branding TO ut_app;
    END IF;
END
$$;

-- Backfill: any tenant that ALREADY consumed a free trial (either has a
-- subscription with plan_type='TRIAL', or a subscription whose first charge
-- was pushed > 1 day past creation — the trial-startAt signature — or a
-- previously-activated first-mandate plan_change_request) is marked used.
-- Idempotent: re-running just re-sets rows already TRUE to TRUE.
UPDATE platform.tenants t
   SET free_trial_used = TRUE
 WHERE free_trial_used = FALSE
   AND (
        EXISTS (SELECT 1 FROM platform.subscriptions s
                 WHERE s.tenant_id = t.id
                   AND (s.plan_type = 'TRIAL'
                        OR (s.next_charge_at IS NOT NULL
                            AND s.next_charge_at > s.created_at + interval '1 day')))
        OR EXISTS (SELECT 1 FROM platform.plan_change_requests p
                    WHERE p.tenant_id = t.id
                      AND p.status = 'ACTIVATED'
                      AND p.replaces_subscription_id IS NULL)
   );
"""


def main() -> None:
    conn = psycopg2.connect(
        host="127.0.0.1", port=15432, dbname="railway",
        user="postgres", password=os.environ["PGPASSWORD"], connect_timeout=20,
    )
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(DDL)

        # Report the shape of what we just did so a failed assertion aborts
        # the transaction cleanly.
        cur.execute("SELECT COUNT(*) FROM platform.tenants WHERE free_trial_used = TRUE")
        used = cur.fetchone()[0]
        print(f"  tenants with free_trial_used=TRUE after backfill: {used}")

        cur.execute("SELECT COUNT(*) FROM platform.tenants")
        total = cur.fetchone()[0]
        print(f"  total tenants: {total}")

        # Reviewer tenant must never be marked used — Play reviewers must
        # continue to get a fresh trial on any test signup they perform.
        cur.execute("""SELECT subdomain, free_trial_used FROM platform.tenants
                        WHERE subdomain = 'demo-hrms'""")
        row = cur.fetchone()
        if row:
            print(f"  reviewer tenant demo-hrms.free_trial_used = {row[1]}")
            if row[1]:
                raise AssertionError(
                    "demo-hrms must NOT be marked free_trial_used — Play reviewer needs "
                    "a fresh trial every time. Aborting.")

        # Confirm the four new columns and the new table exist.
        cur.execute("""SELECT table_schema, table_name, column_name FROM information_schema.columns
                        WHERE (table_schema, column_name) IN
                              (('platform','start_at'),
                               ('platform','trial_ends_at'),
                               ('platform','free_trial_used'))
                        ORDER BY table_name, column_name""")
        for r in cur.fetchall():
            print(f"  column: {r[0]}.{r[1]}.{r[2]}")

        cur.execute("SELECT 1 FROM information_schema.tables WHERE table_schema='platform' AND table_name='tenant_branding'")
        if not cur.fetchone():
            raise AssertionError("platform.tenant_branding was not created — aborting.")
        print("  table: platform.tenant_branding OK")

        conn.commit()
        print("\nCOMMITTED")
    except Exception:
        conn.rollback()
        print("\nROLLED BACK")
        raise


if __name__ == "__main__":
    main()
