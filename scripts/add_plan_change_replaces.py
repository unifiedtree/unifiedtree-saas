"""
Add plan_change_requests.replaces_subscription_id — the "swap the mandate"
column that makes seat changes possible on UPI.

WHY THIS EXISTS
---------------
Razorpay refuses to modify a UPI-backed subscription:

    400 {"error":{"description":
         "subscriptions cannot be updated when payment mode is upi"}}

A UPI Autopay mandate is authorised once, for a fixed amount, and is immutable
for its whole life. Since UPI is how most Indian SMBs pay, "change my seat
count" cannot be an update call for the majority of customers. The only route
the payment network allows is: authorise a NEW mandate for the new amount, and
cancel the old one.

This column links the replacement plan-change request back to the mandate it
supersedes, so activate() can cancel the old subscription at exactly the right
moment — AFTER the new one is confirmed active, never before. Ordering matters
in both directions:

  * cancel-then-authorise would leave a customer with no autopay at all if
    they abandoned the new approval;
  * authorise-and-never-cancel would leave TWO live mandates and bill them
    twice, which is the worst outcome of the two.

Product decision (2026-08-08): we deliberately do NOT request an inflated
max_amount ceiling to leave room for growth. Because every plan change mints a
fresh mandate anyway, each mandate is authorised for exactly the amount it
will charge. The customer approves a number that matches their invoice.

Idempotent — safe to re-run.
"""
import os
import psycopg2

PROXY_HOST = os.getenv("PROXY_HOST", "127.0.0.1")
PROXY_PORT = int(os.getenv("PROXY_PORT", "15432"))
DB_NAME    = os.getenv("DB_NAME", "railway")
DB_USER    = os.getenv("DB_USER", "postgres")   # DDL — not ut_app
DB_PASS    = os.environ["PGPASSWORD"]

DDL = """
BEGIN;

ALTER TABLE platform.plan_change_requests
  ADD COLUMN IF NOT EXISTS replaces_subscription_id VARCHAR(64);

COMMENT ON COLUMN platform.plan_change_requests.replaces_subscription_id IS
  'Razorpay sub_XXX this request supersedes. Set when a customer changes their '
  'seat count on a mandate that cannot be modified in place (UPI). activate() '
  'cancels this subscription only AFTER the replacement is confirmed active, so '
  'the customer is never left unbilled nor billed twice.';

-- The activation path looks this up per request; partial because the vast
-- majority of rows are first-time purchases with no predecessor.
CREATE INDEX IF NOT EXISTS ix_plan_change_requests_replaces
  ON platform.plan_change_requests (replaces_subscription_id)
  WHERE replaces_subscription_id IS NOT NULL;

COMMIT;
"""

VERIFY = """
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='platform' AND table_name='plan_change_requests'
   AND column_name='replaces_subscription_id'
"""


def main():
    conn = psycopg2.connect(host=PROXY_HOST, port=PROXY_PORT, dbname=DB_NAME,
                            user=DB_USER, password=DB_PASS, connect_timeout=15)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
        print("DDL committed OK.")
        with conn.cursor() as cur:
            cur.execute(VERIFY)
            row = cur.fetchone()
            print("replaces_subscription_id:", row if row else "MISSING — ALTER did not apply")
            # ut_app already holds SELECT/INSERT/UPDATE on the table; a new
            # column inherits those grants, so no extra GRANT is needed.
            cur.execute("""
                SELECT privilege_type FROM information_schema.column_privileges
                 WHERE table_schema='platform' AND table_name='plan_change_requests'
                   AND column_name='replaces_subscription_id' AND grantee='ut_app'
                 ORDER BY 1""")
            print("ut_app grants on the new column:", [r[0] for r in cur.fetchall()] or "(inherited from table)")
    except Exception as exc:
        conn.rollback()
        print(f"ROLLBACK: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
