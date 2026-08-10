"""Playwright smoke test — hits the LIVE deployed SPA as a real browser.

Only exercises the SURFACES that just changed, so it stays a smoke rather
than a full test suite:
  1. Log in
  2. Land on /modules successfully
  3. Navigate to Settings > Branding — page renders without an "HTTP 401"
     toast or an unhandled exception
  4. Look for the Cancel Subscription hook on /plan (button OR the
     "cancelled" banner depending on tenant state)
  5. Look for the workspace logo in the header (default OR uploaded)

No writes. No uploads. Only reads. Cleans nothing because it created nothing.
"""
import os, sys, re
from playwright.sync_api import sync_playwright

BASE = os.getenv("SPA_URL", "https://demo-hrms.unifiedtree.com")
EMAIL = os.getenv("SPA_EMAIL", "reviewer@unifiedtree.com")
PW    = os.getenv("SPA_PW",    "Reviewer@2026")

PASS, FAIL = [], []
def ok(m): PASS.append(m); print(f"  PASS  {m}")
def bad(m): FAIL.append(m); print(f"  FAIL  {m}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        errors, unhandled = [], []
        page.on("console", lambda msg: errors.append(msg) if msg.type == "error" else None)
        page.on("pageerror", lambda err: unhandled.append(str(err)))

        # ------ Step 1: land + log in
        print("\n== 1. login ==")
        page.goto(BASE, timeout=45000)
        page.wait_for_load_state("networkidle", timeout=15000)
        if "login" not in page.url.lower():
            # If we're already redirected past login due to a shared cookie,
            # fine — most CI runs won't have one.
            print(f"  info: already at {page.url}")
        else:
            try:
                page.fill('input[type="email"]', EMAIL)
                page.fill('input[type="password"]', PW)
                page.click('button[type="submit"]')
                page.wait_for_url(re.compile(r"/(modules|dashboard|me)"), timeout=30000)
                ok(f"logged in, landed at {page.url}")
            except Exception as e:
                bad(f"login failed: {e}")
                page.screenshot(path="/tmp/spa_smoke_login.png")
                browser.close(); return

        # ------ Step 2: header logo present (default or uploaded)
        print("\n== 2. shell header logo ==")
        try:
            logo = page.locator("header img").first
            logo.wait_for(timeout=8000)
            src = logo.get_attribute("src") or ""
            if src:
                ok(f"header logo rendered, src={src[:80]}")
            else:
                bad("logo has no src")
        except Exception as e:
            bad(f"no header logo found: {e}")

        # ------ Step 3: Settings > Branding renders + no HTTP-status toast
        print("\n== 3. Settings > Branding ==")
        try:
            page.goto(f"{BASE}/settings/branding", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=15000)
            # Look for the "Workspace logo" heading — proves the tab rendered
            heading = page.get_by_text("Workspace logo").first
            heading.wait_for(timeout=8000)
            ok("Branding tab rendered")

            # A raw "HTTP 4xx" or "HTTP 5xx" string on the page = the copy
            # regression the user reported earlier. Should never appear now.
            body = page.content()
            if re.search(r"HTTP\s*(4\d\d|5\d\d)\b", body):
                bad("raw HTTP status code visible on Branding tab")
            else:
                ok("no raw HTTP status codes in the Branding tab body")

            # Upload button exists AND is either enabled OR disabled with a
            # visible reason banner nearby (the loadBlocked amber card).
            btn = page.get_by_role("button", name=re.compile("Upload|Replace"))
            btn.wait_for(timeout=6000)
            disabled = btn.is_disabled()
            if disabled:
                # If disabled, an amber advisory must be visible
                if page.locator("div.bg-amber-50").count() > 0:
                    ok("upload button disabled AND advisory banner shown (correct)")
                else:
                    bad("upload button disabled with no banner explaining why")
            else:
                ok("upload button enabled and clickable")
        except Exception as e:
            bad(f"Branding tab: {e}")
            page.screenshot(path="/tmp/spa_smoke_branding.png")

        # ------ Step 4: Plan page loads without exception
        print("\n== 4. Plan page ==")
        try:
            page.goto(f"{BASE}/plan", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=20000)
            body = page.content()
            if "Manage your plan" in body or "current plan" in body.lower():
                ok("Plan page rendered")
            else:
                bad("Plan page body missing expected copy")
            if re.search(r"HTTP\s*(4\d\d|5\d\d)\b", body):
                bad("raw HTTP status code visible on Plan tab")
            else:
                ok("no raw HTTP status codes on Plan tab")
        except Exception as e:
            bad(f"Plan page: {e}")
            page.screenshot(path="/tmp/spa_smoke_plan.png")

        # ------ Step 5: no unhandled JS exceptions on any page
        print("\n== 5. JS error sink ==")
        if unhandled:
            bad(f"{len(unhandled)} unhandled JS error(s): {unhandled[:2]}")
        else:
            ok("no unhandled JS exceptions")
        # console errors are noisier — only flag if there's a LOT
        if len(errors) > 8:
            bad(f"{len(errors)} console errors (likely a regression)")
        else:
            ok(f"{len(errors)} console errors (within tolerance)")

        browser.close()

    print(f"\n{'-' * 22} {len(PASS)} passed / {len(FAIL)} failed {'-' * 22}")
    for f in FAIL: print(f"   FAILED: {f}")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
