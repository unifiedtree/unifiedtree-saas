"""
Give every workspace a real seat number before seat enforcement goes live.

platform.tenant_modules.seats only started being written when the in-workspace
autopay flow shipped, so every workspace created before that has 0 recorded —
not because it bought nothing, but because nobody wrote a number. Switching on
enforcement against that 0 would have blocked 7 of 9 live workspaces from
adding a single employee, including demo-hrms, the tenant Google's reviewers
sign into. That would fail Play review.

So: grandfather. Each workspace whose recorded seats are 0/absent gets its
CURRENT active headcount as the limit. Nobody loses access to anyone they
already have; everyone must pay to add somebody new. Workspaces that already
carry a real number (paid, or set by the new flow) are left untouched.

Idempotent: re-running only ever raises a 0 to the current headcount, and
never lowers a limit somebody is paying for.
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
        SELECT t.id, t.subdomain,
               (SELECT count(*) FROM hrms.employees e WHERE e.tenant_id=t.id AND e.is_active),
               COALESCE((SELECT max(tm.seats) FROM platform.tenant_modules tm
                          WHERE tm.tenant_id=t.id AND tm.status='ACTIVE'),0),
               COALESCE((SELECT max(s.seats) FROM platform.subscriptions s
                          WHERE s.tenant_id=t.id AND s.razorpay_subscription_id IS NOT NULL
                            AND s.status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')),0)
          FROM platform.tenants t ORDER BY t.subdomain""")
    rows = cur.fetchall()

    changed = 0
    print(f"  {'workspace':<16} {'headcount':>9} {'seats now':>9} {'billed':>7}   action")
    for tid, sd, emps, module_seats, billed in rows:
        if billed > 0:
            print(f"  {sd:<16} {emps:>9} {module_seats:>9} {billed:>7}   skip (paying for {billed})")
            continue
        if module_seats > 0:
            print(f"  {sd:<16} {emps:>9} {module_seats:>9} {billed:>7}   skip (already set)")
            continue
        # Grandfather: at least their current headcount, never below 1 so a
        # brand-new empty workspace can still onboard its first person.
        target = max(emps, 1)
        cur.execute("""UPDATE platform.tenant_modules
                          SET seats = %s
                        WHERE tenant_id = %s AND status='ACTIVE' AND COALESCE(seats,0) = 0""",
                    (target, tid))
        changed += cur.rowcount
        print(f"  {sd:<16} {emps:>9} {module_seats:>9} {billed:>7}   set seats = {target} ({cur.rowcount} module rows)")

    conn.commit()
    print(f"\nCOMMITTED — {changed} module rows given a seat limit.")

    cur.execute("""
        SELECT t.subdomain,
               (SELECT count(*) FROM hrms.employees e WHERE e.tenant_id=t.id AND e.is_active),
               COALESCE((SELECT max(tm.seats) FROM platform.tenant_modules tm
                          WHERE tm.tenant_id=t.id AND tm.status='ACTIVE'),0)
          FROM platform.tenants t ORDER BY t.subdomain""")
    print("\nAfter — nobody should be over their limit:")
    bad = 0
    for sd, emps, seats in cur.fetchall():
        flag = ""
        if seats and emps > seats:
            flag = "  <-- OVER LIMIT"; bad += 1
        print(f"   {sd:<16} {emps} employees / {seats} seats{flag}")
    print(f"\n{'OK — no workspace is locked out.' if not bad else f'WARNING: {bad} workspace(s) over limit'}")
except Exception as e:
    conn.rollback(); print(f"ROLLED BACK: {e}"); raise
finally:
    conn.close()
