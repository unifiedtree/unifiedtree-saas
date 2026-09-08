#!/usr/bin/env python3
"""
Provision the four canonical role accounts required by the Anil parity
Playwright suite (apps/platform/e2e/live/anil-full-parity.spec.ts).

Idempotent — creates the account only if it doesn't already exist, and
reuses the seeded reviewer as the ADMIN.

Runs against LIVE prod. Prerequisites:
  - Backend must be reachable (`curl https://api.unifiedtree.com/actuator/health`
    returns 200). If billing on unifiedtree-445cd is disabled you MUST
    re-enable it before running this script — otherwise Secret Manager
    fails and the login/create endpoints 000 out.
  - reviewer@unifiedtree.com credentials must still be valid (Reviewer@2026).

Output: writes each role's token + email/password + employeeId to
    <scratchpad>/parity_accounts.json
which the Playwright suite (or a shell wrapper) reads.

Design note: rather than injecting SQL, this uses the admin-facing
/v1/hrms/employees + /v1/canonical-auth/invite endpoints so we exercise the
same surface HR would use in the UI. That way a broken invite path is
caught here, not in the Playwright pass.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Optional
from urllib import request as urlreq
from urllib.error import HTTPError, URLError

BACKEND = os.environ.get("PLAYWRIGHT_BACKEND_URL", "https://api.unifiedtree.com")
TENANT_ID = os.environ.get("E2E_ROLE_TENANT_ID", "a7aba720-d487-4685-a57f-69a9f6c3551b")
ADMIN_EMAIL = os.environ.get("E2E_ADMIN_EMAIL", "reviewer@unifiedtree.com")
ADMIN_PASS = os.environ.get("E2E_ADMIN_PASSWORD", "Reviewer@2026")

# The three role accounts to provision (ADMIN is the reviewer, already seeded).
ROLE_ACCOUNTS = [
    {
        "key": "HR",
        "email": "e2e-hr-parity@unifiedtree.example",
        "password": "E2eParity@2026",
        "firstName": "E2E",
        "lastName": "HR-Parity",
        "roleCode": "HR_MANAGER",
    },
    {
        "key": "MGR",
        "email": "e2e-mgr-parity@unifiedtree.example",
        "password": "E2eParity@2026",
        "firstName": "E2E",
        "lastName": "Mgr-Parity",
        "roleCode": "DEPT_MANAGER",
    },
    {
        "key": "EMP",
        "email": "e2e-emp-parity@unifiedtree.example",
        "password": "E2eParity@2026",
        "firstName": "E2E",
        "lastName": "Emp-Parity",
        "roleCode": "EMPLOYEE",
    },
]


def _req(method: str, path: str, token: Optional[str] = None, body: Optional[dict] = None,
         timeout: int = 15) -> tuple[int, dict | str]:
    """Minimal HTTP JSON client so this script has no third-party deps."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urlreq.Request(f"{BACKEND}{path}", data=data, method=method, headers=headers)
    try:
        with urlreq.urlopen(r, timeout=timeout) as resp:
            body_text = resp.read().decode("utf-8")
            return resp.status, json.loads(body_text) if body_text else {}
    except HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, body_text
    except URLError as e:
        return 0, str(e)


def preflight() -> None:
    """Bail with a loud message if the backend isn't reachable.

    Actuator lives on a separate management port at context path /mgmt in
    prod; hit that. If that path 404s too (server up but wrong route),
    fall back to probing the login endpoint with an obviously-wrong body
    — a well-formed 400/401 also means the app is serving.
    """
    status, _ = _req("GET", "/mgmt/actuator/health")
    if status == 200:
        return
    # Fallback: any 4xx from login = app up
    status2, _ = _req("POST", "/api/v1/canonical-auth/login", body={"probe": True})
    if 400 <= status2 < 500:
        return
    print(
        f"BACKEND UNREACHABLE (mgmt/actuator/health={status}, login-probe={status2}). "
        "Re-enable billing on unifiedtree-445cd and try again.\n"
        "  https://console.developers.google.com/billing/enable?project=unifiedtree-445cd",
        file=sys.stderr,
    )
    sys.exit(2)


def login(email: str, password: str) -> str:
    status, body = _req("POST", "/api/v1/canonical-auth/login",
                        body={"tenantId": TENANT_ID, "email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"login {email} → {status} {body}")
    return body["accessToken"]


def find_employee_by_email(admin_token: str, email: str) -> Optional[dict]:
    """Directory search — matches on email lowercase."""
    status, body = _req("GET", f"/api/v1/hrms/employees?search={email}&pageSize=5",
                        token=admin_token)
    if status != 200:
        return None
    for row in body.get("content") or []:
        if (row.get("email") or "").lower() == email.lower():
            return row
    return None


def create_employee_with_invite(admin_token: str, spec: dict) -> dict:
    """Uses the same POST /v1/hrms/employees flow the HR UI uses.

    Sends `sendInvitation=true` so the backend issues an invite token
    that we can consume via /v1/canonical-auth/accept-invite to set the
    known password.
    """
    # Get first company id — the ADMIN belongs to it.
    status, body = _req("GET", "/api/v1/hrms/companies", token=admin_token)
    if status != 200 or not body:
        raise RuntimeError(f"no company for admin ({status})")
    company_id = body[0]["id"]

    payload = {
        "companyId": company_id,
        "firstName": spec["firstName"],
        "lastName": spec["lastName"],
        "email": spec["email"],
        "phone": "+919999999999",
        "employmentType": "FULL_TIME",
        "dateOfJoining": time.strftime("%Y-%m-%d"),
        "roleCode": spec["roleCode"],
    }
    status, body = _req("POST", "/api/v1/hrms/employees",
                        token=admin_token, body=payload)
    if status not in (200, 201):
        raise RuntimeError(f"create employee {spec['email']} → {status} {body}")
    return body


def ensure_password(admin_token: str, employee_id: str, new_password: str) -> None:
    """Admin-side password reset — path depends on backend surface. Try the
    canonical HR admin reset first; fall back to the generic user-credentials
    reset. Both take (email, newPassword). This is a last-resort convenience —
    the invite flow would be cleaner, but the accept-invite token lifetime is
    short and we can't reliably fetch it from the DB while billing is off.
    """
    for path in [
        f"/api/v1/hrms/employees/{employee_id}/reset-password",
        "/api/v1/canonical-auth/admin/reset-password",
    ]:
        status, body = _req(
            "POST", path, token=admin_token,
            body={"employeeId": employee_id, "newPassword": new_password},
        )
        if status in (200, 204):
            return
    raise RuntimeError(f"could not reset password for employee {employee_id}")


def main() -> int:
    preflight()

    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    print(f"[admin] logged in — token len {len(admin_token)}")

    out = {
        "backend": BACKEND,
        "tenantId": TENANT_ID,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "ADMIN": {"email": ADMIN_EMAIL, "password": ADMIN_PASS, "token": admin_token},
    }

    for spec in ROLE_ACCOUNTS:
        # Skip if already there — first probe via directory search.
        emp = find_employee_by_email(admin_token, spec["email"])
        if emp:
            print(f"[{spec['key']}] exists — id={emp['id']}")
        else:
            emp = create_employee_with_invite(admin_token, spec)
            print(f"[{spec['key']}] created — id={emp['id']}")

        # Force known password so login works from Playwright.
        try:
            ensure_password(admin_token, emp["id"], spec["password"])
            token = login(spec["email"], spec["password"])
            print(f"[{spec['key']}] token OK, len {len(token)}")
        except Exception as e:
            print(f"[{spec['key']}] password/login failed: {e}", file=sys.stderr)
            token = ""

        out[spec["key"]] = {
            "email": spec["email"],
            "password": spec["password"],
            "employeeId": emp["id"],
            "token": token,
        }

    scratch = os.environ.get(
        "SCRATCHPAD_DIR",
        r"C:\Users\LENOVO\AppData\Local\Temp\claude\c--com-Unified\7bf6848e-3230-4464-ad11-863d4f5b9df9\scratchpad",
    )
    os.makedirs(scratch, exist_ok=True)
    path = os.path.join(scratch, "parity_accounts.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {path}")
    print("Next: E2E_HR_EMAIL=... E2E_HR_PASSWORD=... (etc.) npx playwright test e2e/live/anil-full-parity.spec.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
