"""V091 mirror: FnF net_settlement must be non-negative.

Flyway is disabled on the live backend (SPRING_FLYWAY_ENABLED=false, ut_app
can't touch flyway_schema_history), so every canonical migration also ships
as a psycopg script that applies the same DDL directly. This one adds a
CHECK constraint on fnf_mgmt.fnf_settlements so a rogue backfill or a
legacy row can never store net_settlement < 0.

Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Wrapped in a single
transaction so a partial apply rolls back.

If existing data violates the constraint the ADD fails with 23514
(check_violation) and prints the offending rows for cleanup.

Run once against prod:
    PGPASSWORD=$(gcloud secrets versions access latest \
        --secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) \
        python scripts/apply_v091_fnf_net_nonneg.py
"""
import os
import sys
import psycopg2
import psycopg2.errors


DDL = """
ALTER TABLE fnf_mgmt.fnf_settlements
    DROP CONSTRAINT IF EXISTS ck_fnf_settlements_net_nonneg;

ALTER TABLE fnf_mgmt.fnf_settlements
    ADD CONSTRAINT ck_fnf_settlements_net_nonneg
    CHECK (net_settlement >= 0);
"""


def main() -> None:
    pw = os.environ.get("PGPASSWORD")
    if not pw:
        raise SystemExit(
            "PGPASSWORD not set. Run:\n"
            "  PGPASSWORD=$(gcloud secrets versions access latest "
            "--secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) "
            "python scripts/apply_v091_fnf_net_nonneg.py"
        )
    host = os.environ.get("PGHOST", "127.0.0.1")
    port = int(os.environ.get("PGPORT", "15432"))
    user = os.environ.get("PGUSER", "postgres")
    db = os.environ.get("PGDATABASE", "postgres")

    print(f"Connecting to {user}@{host}:{port}/{db} ...")
    conn = psycopg2.connect(
        host=host, port=port, user=user, password=pw, dbname=db,
    )
    try:
        with conn:
            with conn.cursor() as cur:
                # Report any violating rows first so operators can act on them
                # BEFORE the ALTER blows up. This is a read; no lock held.
                cur.execute(
                    "SELECT id, tenant_id, employee_id, net_settlement "
                    "  FROM fnf_mgmt.fnf_settlements "
                    " WHERE net_settlement < 0"
                )
                bad = cur.fetchall()
                if bad:
                    print(f"WARN: {len(bad)} row(s) violate net_settlement >= 0:")
                    for row in bad:
                        print(f"  id={row[0]} tenant={row[1]} employee={row[2]} net={row[3]}")
                    print("Aborting BEFORE ALTER — fix the data and re-run.")
                    sys.exit(2)

                try:
                    cur.execute(DDL)
                except psycopg2.errors.CheckViolation as e:
                    print(f"ERROR: check constraint violated during ADD — {e}")
                    raise

                # Confirm the constraint exists.
                cur.execute("""
                    SELECT 1
                      FROM pg_constraint c
                      JOIN pg_class t ON t.oid = c.conrelid
                      JOIN pg_namespace n ON n.oid = t.relnamespace
                     WHERE n.nspname = 'fnf_mgmt'
                       AND t.relname = 'fnf_settlements'
                       AND c.conname = 'ck_fnf_settlements_net_nonneg'
                """)
                assert cur.fetchone(), "constraint ck_fnf_settlements_net_nonneg not found after ADD"
        print("OK - V091 applied (ck_fnf_settlements_net_nonneg present).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
