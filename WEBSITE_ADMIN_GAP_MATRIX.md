# SaaS Portal -- Canonical Wiring Gap Matrix

What the customer-facing flow needs vs what canonical-prod actually serves
today. This doc is the single source of truth for the "SaaS Portal Canonical
Wiring" workstream.

Decisions are pinned at the bottom (section 6). No code changes have been made.

---

## 1. Critical finding: SaaS controllers are NOT loaded under canonical-prod

`backend/app/hrms-app/src/main/java/com/hrms/app/config/CanonicalProfileScan.java`
sets `@Profile("canonical")` and `@ComponentScan(basePackages = {...})` with
exactly these entries:

```
com.hrms.core.exception
com.hrms.core.audit
com.hrms.employee.workforce
com.hrms.api.workforce
com.hrms.api.settings
com.hrms.api.auth.canonical
com.hrms.api.rbac
com.unifiedtree
```

The SaaS controllers live under `com.hrms.api.saas`, which is NOT in this list.
The legacy tenant-login controller lives under `com.hrms.api.auth` (also not
in the list).

Consequence on the Railway-deployed backend (`canonical,canonical-prod`):

| Route | Status |
|---|---|
| `POST /v1/canonical-auth/login` | served (working) |
| `POST /v1/hrms/companies` etc. (workforce) | served (working) |
| `GET /v1/settings/*` | served (working) |
| `POST /v1/public/signup-request` | **404** |
| `GET /v1/public/subdomains/check` | **404** |
| `GET /v1/public/workspace-status` | **404** |
| `POST /v1/auth/login` (legacy tenant) | **404** |
| `POST /v1/platform/auth/login` (admin) | **404** |
| `GET /v1/platform/tenant-requests` | **404** |
| `POST /v1/platform/tenant-requests/{id}/approve` | **404** |
| `POST /v1/platform/tenant-requests/{id}/reject` | **404** |

So the deployed backend cannot accept a new customer, cannot let an admin
approve them, cannot let a tenant user log in. The frontend code makes the
right calls -- the backend just isn't there.

---

## 2. Page-to-endpoint map (frontend reality)

### apps/website (marketing + signup)

| Page | Calls | Schema today | Canonical-ready |
|---|---|---|---|
| HomePage | -- | -- | n/a (static) |
| PricingPage | -- | -- | n/a (static) |
| ModulesPage | -- | -- | n/a (static) |
| RegisterPage | `POST /v1/public/signup-request`, `GET /v1/public/subdomains/check?slug=` | LEGACY `tenants`/`user_credentials`/`companies`/`branches`/`departments`/`employees`/`tenant_domains` | **NO** -- writes legacy tables, controller not loaded |
| CheckoutPage | -- (disabled placeholder) | -- | n/a (deliberately disabled) |
| LoginPage (website) | redirect to subdomain `/login` only | n/a | n/a |

### apps/admin (UnifiedTree admin portal)

| Page | Calls | Schema today | Canonical-ready |
|---|---|---|---|
| AdminLogin | `POST /v1/platform/auth/login` | LEGACY `platform_admins` | **NO** |
| Tenants | `GET /v1/platform/tenant-requests` | LEGACY `tenants` joined with canonical `platform.tenant_modules` | **NO** (controller not loaded) |
| TenantDetail | `POST /v1/platform/tenant-requests/{id}/approve|reject` | dual-write: LEGACY `tenants.status` + canonical `platform.tenant_modules` | **NO** (controller not loaded) |
| AdminDashboard | hardcoded stats | mock | n/a |
| GlobalUsers | (not wired) | mock | n/a |
| GlobalAuditLogs | (not wired) | mock | n/a |
| Revenue / PlatformHealth / Support / Announcements / AdminSettings | (not wired) | mock | n/a |

### apps/platform (tenant workspace shell)

| Page / module | Calls | Schema today | Canonical-ready |
|---|---|---|---|
| LoginPage | `POST /v1/auth/login` then `GET /v1/public/workspace-status` | LEGACY auth + LEGACY workspace status (which reads canonical `platform.tenant_modules` internally) | **NO** -- posts to non-loaded legacy `/v1/auth/login` |
| PendingApproval | `GET /v1/public/workspace-status` | as above | **NO** (controller not loaded) |
| Dashboard | -- | mock | n/a |
| Users / Roles / Settings / Files / Analytics / AuditLogs / Onboarding | -- | mock | n/a |
| ModuleGate component | reads `tenant.activeModules` from local store | local store only | YES (frontend-side gate, OK as-is) |
| /hrms/employees, /hrms/attendance, /hrms/leave, /crm/leads, ... | (page components mock) | mock | n/a |

---

## 3. What the canonical schema ALREADY provides

`backend/app/hrms-app/src/main/resources/db/canonical/V002__platform.sql`:

| Table | Purpose | Notes |
|---|---|---|
| `platform.tenants` | Tenant lifecycle (PENDING_APPROVAL, ACTIVE, ...) | `requested_modules TEXT[]` column captures sign-up request |
| `platform.tenant_domains` | Subdomain + custom-domain reservation | UNIQUE on `domain` |
| `platform.module_catalog` | Master list of buyable modules | Already seeded: hrms, attendance, leave, payroll, recruitment, performance, learning, expense, compliance, crm, accounts |
| `platform.tenant_modules` | Per-tenant module lifecycle (REQUESTED -> APPROVED -> ACTIVE -> SUSPENDED -> EXPIRED) | Status check constraint in V014 |
| `auth.user_credentials` | Tenant-scoped users (FORCE RLS) | Holds tenant admin + employees |
| `rbac.roles`, `rbac.user_roles`, `rbac.permissions` | RBAC | System roles seeded by V017 |

**No new tables needed for the customer flow.** The schema is complete.

What is missing only in code:
- Canonical signup service that writes `platform.tenants` + `platform.tenant_domains` + first `auth.user_credentials`.
- Canonical platform-admin login (no new table needed -- see decision #2 in section 6).
- Canonical approval flow that transitions `platform.tenants.status` and `platform.tenant_modules.status`.
- Inclusion of the new controllers in `CanonicalProfileScan`.

---

## 4. Endpoint design (canonical replacements)

URL paths kept identical to legacy so the frontend does NOT have to change
routes. Only one frontend POST body needs to change: platform LoginPage must
include `tenantId` so it hits `/v1/canonical-auth/login`. See decision #5.

### 4.1 `POST /v1/public/signup-request`

Request body (unchanged from current `SaasDtos.SignupRequest`):
```
{ companyName, subdomain, adminName, adminEmail, adminMobile?,
  password, industry?, country?, timezone?, currency?,
  requestedModules: ["hrms","attendance",...] }
```

Server-side actions:
1. Validate `subdomain` against `platform.tenants.subdomain` UNIQUE.
2. INSERT `platform.tenants` (status='PENDING_APPROVAL', requested_modules=[...]).
3. INSERT `platform.tenant_domains` (domain=`<subdomain>.unifiedtree.com`, is_primary=true).
4. For each requested module: INSERT `platform.tenant_modules` (status='REQUESTED').
5. SET LOCAL `app.tenant_id` = new tenant id, then:
   INSERT `auth.user_credentials` (tenant_id, email, password_hash, is_active=true).
6. INSERT `rbac.user_roles` granting SUPER_ADMIN role for this tenant.
7. Return: `{ tenantId, subdomain, workspaceUrl, requestedModules, message }`.

DB role: requires `ut_app` to have INSERT on `platform.tenants`, `platform.tenant_domains`, `platform.tenant_modules`, `auth.user_credentials`, `rbac.user_roles` -- all granted by current Railway grants.

### 4.2 `GET /v1/public/subdomains/check?slug=acme`

Server-side: `SELECT EXISTS (SELECT 1 FROM platform.tenants WHERE subdomain = ?)`.

Response: `{ subdomain, available, reason }`.

### 4.3 `GET /v1/public/workspace-status`

Resolves tenant via Host header (`acme.unifiedtree.com` -> subdomain=acme) OR
via `X-Tenant-Subdomain` header OR `X-Tenant-ID`. Resolution rule kept from
legacy.

Server-side:
1. Look up `platform.tenants` by subdomain/id.
2. Read `platform.tenant_modules` rows for that tenant.
3. `activeModules` = rows with `status='ACTIVE'`.
4. `requestedModules` = rows with `status IN ('REQUESTED','APPROVED')`.
5. Return: `{ tenantId, tenantName, subdomain, status, requestedModules, activeModules }`.

This endpoint is the ONE place the platform login flow gets `activeModules`
today; keeping it as-is means the frontend doesn't have to change here.

### 4.4 `POST /v1/platform/auth/login` (platform admin login)

Request: `{ email, password }`.

Server-side:
1. Look up `auth.user_credentials` where `tenant_id = '00000000-0000-0000-0000-000000000000'` (the platform tenant) AND email matches.
2. Verify bcrypt password.
3. Build JWT with `tenant_id=PLATFORM_TENANT`, `roles=[PLATFORM_SUPER_ADMIN]`, `permissions=[platform.tenant.approve, platform.tenant.reject, platform.tenant.read]`.
4. Return: `{ accessToken, expiresIn, adminId, email, name, roles }`.

No new table. The "platform admin" is just a user belonging to the special
`00000000-0000-0000-0000-000000000000` tenant. A new
`PlatformAdminBootstrap` (mirror of the existing `InitialAdminBootstrap`)
creates that admin from env vars on first deploy.

A new migration `V019__seed_platform_super_admin.sql` adds:
- Permission codes `platform.tenant.read`, `platform.tenant.approve`, `platform.tenant.reject`.
- Role `PLATFORM_SUPER_ADMIN` with those permissions.

### 4.5 `GET /v1/platform/tenant-requests`

Server-side: SELECT from `platform.tenants` LEFT JOIN `platform.tenant_modules`,
LEFT JOIN `auth.user_credentials` (for admin email of that tenant) -- needs
`SET LOCAL app.tenant_id` for the user join, OR a SECURITY DEFINER function,
OR just store admin email in `platform.tenants` (an `admin_email` column --
no migration needed because we control the writes).

Cleanest: add an `admin_email` and `admin_name` column to `platform.tenants`
via migration `V020__tenant_admin_columns.sql` so the platform admin doesn't
need to switch tenant context to read it.

Response: array of `TenantRequestSummary` -- same shape as today.

Gate: `@PreAuthorize("hasAuthority('platform.tenant.read')")`.

### 4.6 `POST /v1/platform/tenant-requests/{tenantId}/approve|reject`

Approve body: `{ approvedModules: ["hrms","attendance"], note? }`.

Server-side approve:
1. UPDATE `platform.tenants` SET status='ACTIVE', approved_at=now(), approved_by=<platform_admin_user_id>.
2. For each approvedModules: UPDATE `platform.tenant_modules` SET status='ACTIVE', approved_at=now(), activated_at=now() WHERE tenant_id=? AND module_key=?.
3. Modules NOT in approvedModules but in original request: UPDATE status='REJECTED' (or leave 'REQUESTED' for a later batch; pick policy).

Reject body: `{ reason }`.

Server-side reject:
1. UPDATE `platform.tenants` SET status='REJECTED'.
2. UPDATE all tenant_modules for that tenant SET status='EXPIRED' (or similar terminal).

Gate: `@PreAuthorize("hasAuthority('platform.tenant.approve')")` for approve, `platform.tenant.reject` for reject.

---

## 5. Code changes required (minimum)

### Backend

| File | Action |
|---|---|
| New module `backend/platform/platform-saas/` | Create Maven module, parent = `backend/pom.xml`. |
| New `com.unifiedtree.saas.PublicSaasController` | Implements 4.1, 4.2, 4.3 against canonical schemas. |
| New `com.unifiedtree.saas.PlatformSaasController` | Implements 4.4, 4.5, 4.6. |
| New `com.unifiedtree.saas.SaasService` | Business logic via JdbcTemplate + `TenantContext.setTenantId(...)` for tenant-scoped inserts. |
| New `com.unifiedtree.saas.dto.SaasDtos` | Records identical to current `com.hrms.api.saas.SaasDtos` (saves the frontend DTOs). |
| New migration `V019__seed_platform_super_admin.sql` | Permissions + role for platform admin. |
| New migration `V020__tenant_admin_columns.sql` | `admin_email`, `admin_name`, `admin_phone` on `platform.tenants`. |
| New `com.unifiedtree.saas.bootstrap.PlatformAdminBootstrap` | Env-driven one-time create of the platform-admin user in tenant 00000000... |
| `CanonicalProfileScan.java` | No change required -- `com.unifiedtree` is already in the scan list, so the new package gets picked up automatically. |
| Legacy `com.hrms.api.saas.*` | Leave in place (only loaded under `DefaultProfileScan`, i.e., non-canonical profiles). When the new module ships, delete it in a follow-up commit. |

### Frontend

| File | Change |
|---|---|
| `apps/platform/src/core/auth/LoginPage.tsx` | Change `apiJson('/v1/auth/login', {email,password})` to `apiJson('/v1/canonical-auth/login', {tenantId: status.tenantId, email, password})`. The page already loads workspace-status before login -- `status.tenantId` is available. |
| `apps/website/src/pages/RegisterPage.tsx` | No URL change. The endpoint URL is preserved; the new backend handler accepts the same request body. |
| `apps/admin/src/lib/api.ts` and pages | No URL changes. The endpoints `/v1/platform/auth/login`, `/v1/platform/tenant-requests*` are preserved. |

That's it for the customer-flow handoff. Mock admin/platform dashboards
(GlobalUsers, AdminDashboard, etc.) can stay mock and be filled in
independently after handoff.

---

## 6. Decisions (pinned)

1. **Port or new package?** **New package** `com.unifiedtree.saas` in new Maven module `backend/platform/platform-saas`. Reason: naming consistency with `com.unifiedtree.auth/rbac/settings`, auto-picked-up by canonical scan, clean break from legacy JdbcTemplate-against-old-tables code.

2. **Where do platform admins live?** **Reuse `auth.user_credentials`** with the fixed platform-tenant UUID `00000000-0000-0000-0000-000000000000`. No new `platform_admins` table. Bootstrap via new `PlatformAdminBootstrap` mirroring `InitialAdminBootstrap`.

3. **Pending-module storage?** **Reuse `platform.tenant_modules.status='REQUESTED'`**. No new `tenant_module_requests` table.

4. **Subdomain reservation?** **Reuse `platform.tenants.subdomain` UNIQUE** (no separate reservation table; tenant row created in PENDING_APPROVAL state IS the reservation).

5. **Frontend URL changes?** **Only one**: platform LoginPage switches to `/v1/canonical-auth/login` and starts sending `tenantId`. All other URLs preserved.

6. **Payment?** **Not in scope here.** Manual approval continues. A `BILLING_PLAN.md` will be drafted later when Stripe/Razorpay is picked.

7. **Mock admin/platform dashboards?** **Out of scope here.** They stay mock; they're not blockers for HRMS/CRM/Attendance teammate work.

---

## 7. Readiness flags (current state)

| Flag | State | Why |
|---|---|---|
| Website customer flow canonical-ready | **NO** | SaaS controllers not loaded under canonical-prod; signup writes legacy tables |
| Admin approval canonical-ready | **NO** | Same: PlatformSaasController not loaded |
| Module dashboard gating ready | **YES** (frontend) / **NO** (backend not serving workspace-status under canonical) | `ModuleGate` works once `/v1/public/workspace-status` is served by the new controller |
| Can HRMS teammate start | **YES (with workaround)** | They work under tenant context that the bootstrap admin already provides; their changes are in `backend/modules/hrms-*` + `apps/platform/src/modules/hrms/*` which are downstream of auth. They can use the existing bootstrap admin for local testing, no signup needed. |
| Can Attendance App work start (you) | **YES** | Mobile app talks to backend via JWT. JWT from `/v1/canonical-auth/login` already works. Attendance backend canonical APIs are Phase 2 (separate workstream). |
| Can CRM teammate start | **YES** (with the same workaround) | They work in a brand-new `backend/modules/mod-crm` + `apps/platform/src/modules/crm/*`. Login is via canonical auth; tenant context is set. |

The handoff is NOT blocked on the SaaS portal canonical wiring. Teammates
work below the signup/approval layer.

---

## 8. Order of work (proposed)

Pick A or B. Both unblock teammates today. A is faster; B is more end-to-end.

**A. Hand off NOW, wire SaaS portal in parallel.** Teammates branch off
   `feat/canonical-foundation` today using the bootstrap admin for local dev.
   The SaaS portal wiring (new `platform-saas` module, V019, V020, frontend
   one-line change) ships as a separate PR on its own timeline. Risk: until
   that PR lands, no NEW tenant can sign up on the live backend.

**B. Wire SaaS portal first, then hand off.** ~3-5 days of focused backend
   work + the 1-line frontend change. After that, teammates branch off a
   second checkpoint commit. Risk: 3-5 days of idle time for teammates.

Recommend **A** unless you have a customer demo coming up that depends on
self-serve signup.
