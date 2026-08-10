"""End-to-end automation test of the UnifiedTree money path, against PRODUCTION.

    free signup -> login -> pick modules -> autopay setup -> Razorpay subscription
    -> [synthetic signed webhook] -> subscription ACTIVE -> modules granted
    -> seat change -> add a second module -> cleanup

WHY A SYNTHETIC WEBHOOK
    Razorpay is in LIVE mode. Authorising a mandate for real costs money and has
    already burned +/- Rs 5 several times. Creating a subscription OBJECT costs
    nothing (no money moves until a human authorises the mandate), so the test
    creates one and then delivers the `subscription.activated` webhook itself,
    HMAC-signed with the real secret exactly as Razorpay would. Every line of our
    handling code runs; nothing is charged. The subscription is cancelled at the
    end regardless of outcome.

    This is the only kind of test that has ever caught the bugs in this flow.
    Five separate defects (Razorpay body shape, an ON CONFLICT partial index, a
    @Transactional propagation error, a subdomain check that matched its own row,
    and billing_cycle casing) all passed code review AND typecheck, and were
    caught only here.

SAFETY
    - Creates ONE scratch tenant with a random subdomain, and deletes it at the end.
    - Never authorises a mandate. Never calls a charge/capture endpoint.
    - Cancels the Razorpay subscription it created, in a finally block.
    - Touches no other tenant's data.

USAGE
    PGPASSWORD=$(gcloud secrets versions access latest --secret=POSTGRES_ROOT_PASSWORD \
        --project unifiedtree-445cd) python scripts/e2e_money_path.py
"""
import base64
import hashlib
import hmac
import json
import os
import random
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = os.getenv("API_BASE", "https://api.unifiedtree.com/api")
# The only AVAILABLE plan in platform.module_plans. Everything else is
# LAUNCHING_SOON at Rs 0 or RETIRED, so this is the sole purchasable product.
PLAN = os.getenv("E2E_PLAN_KEY", "hr-employees")
PROJECT = "unifiedtree-445cd"

PASS, FAIL, WARN = [], [], []
COMPLETED = False


def ok(m):
    PASS.append(m)
    print(f"  PASS  {m}")


def bad(m):
    FAIL.append(m)
    print(f"  FAIL  {m}")


def warn(m):
    WARN.append(m)
    print(f"  WARN  {m}")


def head(m):
    print(f"\n{'=' * 4} {m} {'=' * 4}")


def secret(name):
    r = subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest",
         f"--secret={name}", f"--project={PROJECT}"],
        capture_output=True, text=True, shell=True)
    if r.returncode != 0:
        raise SystemExit(f"cannot read secret {name}: {r.stderr[:200]}")
    return r.stdout.strip()


def http(method, url, body=None, token=None, extra_headers=None, timeout=90):
    """Returns (status, parsed-body-or-text). Never raises on HTTP status."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            try:
                return r.status, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:                                   # noqa: BLE001
        return 0, str(e)


def raw_post(url, raw_body: bytes, headers):
    req = urllib.request.Request(url, data=raw_body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:                                   # noqa: BLE001
        return 0, str(e)


def db():
    import psycopg2
    return psycopg2.connect(host="127.0.0.1", port=15432, dbname="railway",
                            user="postgres", password=os.environ["PGPASSWORD"],
                            connect_timeout=20)


def rand(n=6):
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))


# --------------------------------------------------------------------------
# Razorpay helpers — only ever used to READ or CANCEL. Never to charge.
# --------------------------------------------------------------------------
def rzp(method, path, key_id, key_secret, body=None):
    url = "https://api.razorpay.com/v1" + path
    auth = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
    return http(method, url, body, extra_headers={"Authorization": "Basic " + auth})


def main():
    global COMPLETED
    suffix = rand()
    sub_domain = f"e2e{suffix}"
    admin_email = f"e2e+{suffix}@unifiedtree.com"
    admin_pw = "E2eTest@2026x"
    tenant_id = None
    rzp_sub_id = None

    key_id = secret("RAZORPAY_KEY_ID")
    key_secret = secret("RAZORPAY_KEY_SECRET")
    wh_secret = secret("RAZORPAY_WEBHOOK_SECRET")
    print(f"Razorpay mode: {'LIVE' if key_id.startswith('rzp_live') else 'TEST'} "
          f"(no mandate will be authorised, so nothing can be charged)")

    try:
        # ------------------------------------------------------------------
        head("1. public pricing — what a visitor sees before signing up")
        st, plans = http("GET", f"{API}/v1/public/modules")
        if st != 200:
            st, plans = http("GET", f"{API}/v1/public/module-plans")
        if st == 200 and plans:
            rows = plans if isinstance(plans, list) else plans.get("modules") or plans.get("plans") or []
            ok(f"public plan catalogue returns {len(rows)} plan(s)")
            with db() as c, c.cursor() as cur:
                cur.execute("SELECT count(*) FROM platform.module_plans")
                n = cur.fetchone()[0]
            if rows and len(rows) == n:
                ok(f"catalogue matches platform.module_plans ({n} rows)")
            else:
                warn(f"catalogue has {len(rows)} entries but module_plans has {n}")
            for r in rows[:12]:
                if isinstance(r, dict):
                    print(f"      {r.get('planKey') or r.get('key'):<16} "
                          f"{str(r.get('monthlyPriceInr') or r.get('priceInr') or r.get('price')):>8}  "
                          f"{r.get('status') or r.get('launchStatus') or ''}")
        else:
            bad(f"no public plan catalogue endpoint responded (last status {st})")

        # ------------------------------------------------------------------
        head("2. subdomain availability")
        st, r = http("GET", f"{API}/v1/public/subdomains/check?slug={sub_domain}")
        free_ok = st == 200 and (r or {}).get("available") is True
        ok(f"unused subdomain reported available") if free_ok else bad(f"free subdomain check: {st} {r}")
        st, r = http("GET", f"{API}/v1/public/subdomains/check?slug=demo-hrms")
        taken_ok = st == 200 and (r or {}).get("available") is False
        ok("taken subdomain reported unavailable") if taken_ok else bad(f"taken subdomain check: {st} {r}")

        # ------------------------------------------------------------------
        head("3. retired trial must stay dead")
        st, _ = http("POST", f"{API}/v1/public/signup-request", {"x": 1})
        ok("POST /v1/public/signup-request -> 410 GONE") if st == 410 else \
            bad(f"retired trial endpoint returned {st}, expected 410")

        # ------------------------------------------------------------------
        head("4. free signup (no payment)")
        st, r = http("POST", f"{API}/v1/public/free-signup", {
            "companyName": f"E2E Test {suffix}", "subdomain": sub_domain,
            "adminName": "E2E Runner", "adminEmail": admin_email,
            "adminMobile": "9000000000", "password": admin_pw,
            "country": "India", "timezone": "Asia/Kolkata", "currency": "INR",
        })
        if st in (200, 201) and isinstance(r, dict) and r.get("tenantId"):
            tenant_id = r["tenantId"]
            ok(f"workspace created: {r.get('subdomain')} ({tenant_id[:8]}...)")
        else:
            bad(f"free-signup failed: {st} {str(r)[:300]}")
            return

        # ------------------------------------------------------------------
        head("5. login to the new workspace")
        st, r = http("POST", f"{API}/v1/canonical-auth/login",
                     {"tenantId": tenant_id, "email": admin_email, "password": admin_pw})
        tok = (r or {}).get("accessToken") if st == 200 else None
        if tok:
            ok("admin can sign in immediately after signup")
            claims = json.loads(base64.urlsafe_b64decode(
                tok.split(".")[1] + "=" * ((4 - len(tok.split(".")[1]) % 4) % 4)))
            ok(f"JWT carries tenant_id + roles {claims.get('roles')}") if claims.get("tenant_id") == tenant_id \
                else bad("JWT tenant_id does not match the new workspace")
        else:
            bad(f"login failed: {st} {str(r)[:200]}")
            return

        # ------------------------------------------------------------------
        head("6. a brand-new workspace has no plan yet")
        st, cur_plan = http("GET", f"{API}/v1/workspace/plan/current", token=tok)
        if st == 200:
            subs = (cur_plan or {}).get("subscriptions", [])
            ok("current-plan endpoint works and reports no subscription") if not subs \
                else warn(f"new workspace already shows {len(subs)} subscription(s): {subs}")
        else:
            bad(f"/v1/workspace/plan/current -> {st} {str(cur_plan)[:200]}")

        # ------------------------------------------------------------------
        head("7. autopay setup — creates a Razorpay subscription, charges nothing")
        st, setup = http("POST", f"{API}/v1/workspace/plan/setup-autopay", {
            "items": [{"planKey": PLAN, "seats": 5}], "billingCycle": "monthly",
        }, token=tok)
        if st in (200, 201) and isinstance(setup, dict) and setup.get("razorpaySubscriptionId"):
            rzp_sub_id = setup["razorpaySubscriptionId"]
            pcr_id = setup.get("planChangeRequestId")
            ok(f"Razorpay subscription created: {rzp_sub_id}")
            ok("checkout URL returned") if setup.get("checkoutShortUrl") else warn("no checkoutShortUrl")
            ok("key id returned for the client") if setup.get("keyId") else warn("no keyId in response")
        else:
            bad(f"setup-autopay failed: {st} {str(setup)[:400]}")
            return

        with db() as c, c.cursor() as cur:
            cur.execute("""SELECT status, plan_items, billing_cycle, razorpay_subscription_id
                             FROM platform.plan_change_requests WHERE tenant_id=%s""", (tenant_id,))
            rows = cur.fetchall()
        if len(rows) == 1 and rows[0][0] == "AWAITING_MANDATE":
            ok("exactly one plan_change_request, AWAITING_MANDATE")
            print(f"      items={rows[0][1]} cycle={rows[0][2]} rzp={rows[0][3]}")
        else:
            bad(f"unexpected plan_change_requests: {rows}")

        head("7b. duplicate setup must not create a second mandate")
        st2, dup = http("POST", f"{API}/v1/workspace/plan/setup-autopay", {
            "items": [{"planKey": PLAN, "seats": 5}], "billingCycle": "monthly",
        }, token=tok)
        with db() as c, c.cursor() as cur:
            cur.execute("SELECT count(*) FROM platform.plan_change_requests WHERE tenant_id=%s", (tenant_id,))
            n = cur.fetchone()[0]
        if n == 1:
            ok("second setup-autopay reused the pending request (no duplicate mandate)")
        else:
            bad(f"DOUBLE-BILLING RISK: {n} pending plan_change_requests after a repeat click")

        # ------------------------------------------------------------------
        head("8. synthetic signed webhook — subscription.activated")
        payload = {
            "entity": "event", "account_id": "acc_e2e", "event": "subscription.activated",
            "contains": ["subscription"],
            "payload": {"subscription": {"entity": {
                "id": rzp_sub_id, "entity": "subscription", "status": "active",
                "current_start": int(time.time()), "current_end": int(time.time()) + 2592000,
                "paid_count": 1, "quantity": 5,
            }}},
            "created_at": int(time.time()),
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        sig = hmac.new(wh_secret.encode(), raw, hashlib.sha256).hexdigest()

        st, body = raw_post(f"{API}/v1/webhooks/razorpay", raw, {
            "Content-Type": "application/json", "X-Razorpay-Signature": sig,
            "X-Razorpay-Event-Id": f"evt_e2e_{suffix}",
        })
        ok(f"signed webhook accepted ({st})") if st in (200, 204) else bad(f"webhook -> {st} {body[:300]}")

        head("8b. an UNSIGNED webhook must be rejected")
        st_bad, _ = raw_post(f"{API}/v1/webhooks/razorpay", raw,
                             {"Content-Type": "application/json",
                              "X-Razorpay-Signature": "deadbeef"})
        ok(f"bad signature rejected ({st_bad})") if st_bad in (400, 401, 403) else \
            bad(f"SECURITY: bad-signature webhook returned {st_bad} — forgeable")

        time.sleep(3)

        # ------------------------------------------------------------------
        head("9. did activation actually grant the plan?")
        with db() as c, c.cursor() as cur:
            cur.execute("""SELECT status, seats, billing_cycle, unit_price_inr, amount_inr,
                                  current_period_end IS NOT NULL
                             FROM platform.subscriptions WHERE tenant_id=%s""", (tenant_id,))
            subs = cur.fetchall()
            cur.execute("""SELECT module_key, status, seats FROM platform.tenant_modules
                            WHERE tenant_id=%s ORDER BY module_key""", (tenant_id,))
            mods = cur.fetchall()
            cur.execute("SELECT status FROM platform.plan_change_requests WHERE tenant_id=%s", (tenant_id,))
            pcr = cur.fetchall()
        print(f"      subscriptions : {subs}")
        print(f"      tenant_modules: {mods}")
        print(f"      pcr status    : {pcr}")

        if len(subs) == 1 and subs[0][0] == "ACTIVE":
            ok("subscription row is ACTIVE")
            if subs[0][1] == 5:
                ok("seats recorded as 5")
            else:
                bad(f"seats wrong: {subs[0][1]}")
            if subs[0][3] and float(subs[0][3]) > 0:
                ok(f"unit price frozen on the ledger row ({subs[0][3]})")
            else:
                bad("unit_price_inr is 0/null — a later seat change would bill Rs 0")
            if subs[0][4] and float(subs[0][4]) > 0:
                ok(f"amount_inr = {subs[0][4]}")
            else:
                bad(f"amount_inr wrong: {subs[0][4]}")
            ok("current_period_end set") if subs[0][5] else bad("current_period_end NULL")
        else:
            bad(f"expected exactly one ACTIVE subscription, got {subs}")

        # A plan is a BUNDLE: platform.module_plans.included_modules lists the
        # module keys it expands into. hr-employees -> attendance, hrms, leave,
        # payroll. Assert against those, not against the plan key itself.
        with db() as c, c.cursor() as cur:
            cur.execute("SELECT included_modules FROM platform.module_plans WHERE key=%s", (PLAN,))
            row = cur.fetchone()
        expected = set(row[0] or []) if row else set()
        granted = {m[0] for m in mods if m[1] == "ACTIVE"}
        if expected and expected <= granted:
            ok(f"{PLAN} expanded into all {len(expected)} bundled modules: {sorted(expected)}")
        elif expected:
            bad(f"{PLAN} missing modules {sorted(expected - granted)} (granted {sorted(granted)})")
        else:
            bad(f"{PLAN} has no included_modules in the catalogue")
        if all(m[2] == 5 for m in mods):
            ok("every bundled module carries the paid seat count (5)")
        else:
            bad(f"seat count inconsistent across bundled modules: {mods}")
        if pcr and all(p[0] in ("ACTIVATED", "COMPLETED", "DONE") for p in pcr):
            ok(f"plan_change_request closed out ({pcr[0][0]})")
        else:
            warn(f"plan_change_request left as {pcr}")

        head("9b. replaying the SAME webhook must not double-grant")
        raw_post(f"{API}/v1/webhooks/razorpay", raw,
                 {"Content-Type": "application/json", "X-Razorpay-Signature": sig,
                  "X-Razorpay-Event-Id": f"evt_e2e_{suffix}"})
        time.sleep(2)
        with db() as c, c.cursor() as cur:
            cur.execute("SELECT count(*) FROM platform.subscriptions WHERE tenant_id=%s", (tenant_id,))
            n2 = cur.fetchone()[0]
        ok("replay did not create a second subscription") if n2 == 1 else \
            bad(f"IDEMPOTENCY BUG: {n2} subscription rows after replaying one webhook")

        # ------------------------------------------------------------------
        head("10. the UI's 'Manage Plan' view now shows the subscription")
        st, cur_plan = http("GET", f"{API}/v1/workspace/plan/current", token=tok)
        subs_api = (cur_plan or {}).get("subscriptions", []) if st == 200 else []
        if subs_api:
            s0 = subs_api[0]
            ok(f"current plan shows {s0.get('primaryPlanKey')} seats={s0.get('seats')} "
               f"status={s0.get('status')} billed={s0.get('billed')}")
            ok("marked billed=true (seat controls will render)") if s0.get("billed") else \
                bad("billed=false — the UI will offer 'set up autopay' again to a paying customer")
        else:
            bad(f"MANAGE PLAN EMPTY after a successful payment: {st} {str(cur_plan)[:300]}")

        # ------------------------------------------------------------------
        head("11. seat limit enforcement")
        st, r = http("GET", f"{API}/v1/hrms/employees?page=0&size=1", token=tok)
        ok("employee list reachable") if st == 200 else warn(f"employee list -> {st}")
        with db() as c, c.cursor() as cur:
            cur.execute("""SELECT max(seats) FROM platform.tenant_modules
                            WHERE tenant_id=%s AND status='ACTIVE'""", (tenant_id,))
            lim = cur.fetchone()[0]
        ok(f"seat limit visible to the guard: {lim}") if lim else \
            bad("no seat limit on tenant_modules — SeatLimitGuard will fail open")

        # ------------------------------------------------------------------
        head("12. seat change on a live subscription")
        st, r = http("POST", f"{API}/v1/workspace/plan/change-seats",
                     {"planKey": PLAN, "newSeats": 8}, token=tok)
        print(f"      change-seats -> {st} {str(r)[:260]}")
        if st == 200 and isinstance(r, dict):
            if r.get("checkoutShortUrl"):
                ok("seat change needs re-authorisation (correct for an immutable UPI mandate)")
            else:
                ok(f"seat change applied in place: {r.get('previousSeats')} -> {r.get('newSeats')}")
            with db() as c, c.cursor() as cur:
                cur.execute("SELECT seats FROM platform.subscriptions WHERE tenant_id=%s", (tenant_id,))
                print(f"      subscription seats now: {cur.fetchone()}")
        elif st in (400, 409, 422):
            warn(f"seat change refused ({st}) — check the reason is intentional: {str(r)[:200]}")
        else:
            bad(f"change-seats -> {st} {str(r)[:300]}")

        # ------------------------------------------------------------------
        head("13. cross-tenant isolation (most important security check)")
        other = "a7aba720-d487-4685-a57f-69a9f6c3551b"      # demo tenant
        st, r = http("GET", f"{API}/v1/hrms/employees?page=0&size=5", token=tok)
        leaked = False
        if st == 200:
            content = (r or {}).get("content", [])
            for e in content:
                if "demo-hrms" in json.dumps(e):
                    leaked = True
        ok("scratch tenant sees only its own employees") if not leaked else \
            bad("TENANT LEAK: demo-hrms data visible from the scratch workspace")
        st, r = http("GET", f"{API}/v1/workspace/plan/current",
                     token=tok, extra_headers={"X-Tenant-ID": other})
        with_header = (r or {}).get("subscriptions", []) if st == 200 else []
        if any((s.get("razorpaySubscriptionId") or "") not in ("", rzp_sub_id) for s in with_header):
            bad("TENANT LEAK: X-Tenant-ID header overrode the JWT tenant")
        else:
            ok("X-Tenant-ID header cannot override the JWT tenant")

        head("14. billing endpoints reject anonymous callers")
        for p in ["/v1/workspace/plan/current", "/v1/workspace/plan/setup-autopay"]:
            st, _ = http("GET" if "current" in p else "POST", API + p, {} if "setup" in p else None)
            ok(f"{p} requires auth ({st})") if st in (401, 403) else \
                bad(f"SECURITY: {p} reachable unauthenticated ({st})")

        COMPLETED = True
    except Exception:                                            # noqa: BLE001
        import traceback
        bad("HARNESS CRASHED mid-run - everything after this point was NOT tested")
        traceback.print_exc()
    finally:
        head("cleanup")
        if rzp_sub_id:
            st, _ = rzp("POST", f"/subscriptions/{rzp_sub_id}/cancel", key_id, key_secret,
                        {"cancel_at_cycle_end": 0})
            print(f"  razorpay subscription {rzp_sub_id} cancel -> {st}")
        if tenant_id:
            try:
                with db() as c:
                    c.autocommit = False
                    cur = c.cursor()
                    for tbl in ["attendance.employee_shift_assignments",
                                "attendance.shift_policies",
                                "platform.plan_change_requests", "platform.subscriptions",
                                "platform.tenant_modules", "platform.tenant_branding",
                                "platform.account_workspaces",
                                "notif.notifications", "notif.device_tokens",
                                "auth.refresh_tokens", "auth.user_credentials",
                                "hrms.employees", "hrms.departments",
                                "leave_mgmt.leave_balances", "leave_mgmt.leave_types",
                                "attendance.shift_policies",
                                "platform.tenant_domains", "platform.tenants"]:
                        try:
                            cur.execute(f"DELETE FROM {tbl} WHERE tenant_id=%s"
                                        if tbl != "platform.tenants"
                                        else "DELETE FROM platform.tenants WHERE id=%s",
                                        (tenant_id,))
                            if cur.rowcount:
                                print(f"    deleted {cur.rowcount:>3} from {tbl}")
                        except Exception as e:                       # noqa: BLE001
                            c.rollback()
                            print(f"    skip {tbl}: {str(e)[:90]}")
                    c.commit()
                    cur.execute("SELECT count(*) FROM platform.tenants WHERE id=%s", (tenant_id,))
                    print(f"    scratch tenant remaining: {cur.fetchone()[0]}")
            except Exception as e:                                   # noqa: BLE001
                print(f"    CLEANUP FAILED, tenant {tenant_id} left behind: {e}")

        print(f"\n{'-' * 22} {len(PASS)} passed / {len(FAIL)} failed / {len(WARN)} warnings {'-' * 22}")
        for f in FAIL:
            print(f"   FAILED: {f}")
        for w in WARN:
            print(f"   WARN  : {w}")
        sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
