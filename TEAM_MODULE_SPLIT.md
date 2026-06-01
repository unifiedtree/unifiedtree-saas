# Team Module Split

Who owns what for the first parallel sprint. Read this together with
TEAM_HANDOFF.md (module dev rules) and WEBSITE_ADMIN_GAP_MATRIX.md (the
SaaS portal status).

---

## 1. Owners (4 people)

| # | Owner | Scope | Primary files | Primary branch |
|---|---|---|---|---|
| 1 | **Teja** (you) | Attendance App (Expo / mobile) + Attendance backend canonical wiring later | Separate repo for the Expo app. Backend: `backend/modules/hrms-attendance/**`, `backend/app/hrms-api/.../api/attendance/**`, `backend/app/hrms-app/src/main/resources/db/canonical/V0??__attendance_*.sql` | `feat/attendance-app` (mobile repo) and `feat/attendance-canonical` (backend, later) |
| 2 | **Teammate 1** (HRMS lead) | HRMS module: workforce, employee directory, departments, designations, leave canonical | `backend/modules/hrms-employee/**`, `backend/modules/hrms-leave/**`, `backend/app/hrms-api/.../api/workforce/**`, `apps/platform/src/modules/hrms/**` | `feat/hrms-employees`, `feat/hrms-leave`, ... |
| 3 | **Teammate 2** (CRM lead) | CRM module from scratch inside the monolith | NEW: `backend/modules/mod-crm/**` (to scaffold), `backend/app/hrms-api/src/main/java/com/hrms/api/crm/**`, NEW migrations `db/canonical/V0??__crm_*.sql`, `apps/platform/src/modules/crm/**` | `feat/crm-scaffold`, `feat/crm-leads`, ... |
| 4 | **Teammate 3** (WhatsApp + integrations) | WhatsApp automation as a separate worker. NO backend code changes until event contracts are agreed | Own repo (`whatsapp-automation/`, TBD). Backend touches strictly limited to subscribing to the events spec'd in TEAM_HANDOFF.md sec.6 | `feat/whatsapp-worker` (own repo) |

---

## 2. What everyone shares (and CANNOT change without backend-lead review)

- `backend/platform/**` (auth, RBAC, tenant, audit, notifications, settings)
- `backend/shared/**` (DTOs, events, security utilities)
- `backend/app/hrms-app/src/main/resources/db/canonical/V00[1-18]__*.sql` (already shipped; immutable)
- `backend/app/hrms-app/src/main/resources/application*.yml`
- `backend/Dockerfile`, `backend/railway.toml`, `backend/.gitignore`
- `apps/platform/src/core/auth/**` (login + auth store)
- `apps/platform/src/shared/**` (layouts, ModuleGate)
- `packages/**` (sdk, ui-kit, utilities) -- changes need frontend-lead review
- `TEAM_HANDOFF.md`, this doc

Touching any of those = PR review by the backend lead OR the frontend lead.

---

## 3. What each owner can do TODAY (in parallel)

### Teja -- Attendance App
- Spin up the Expo project in a new repo: `unifiedtree-attendance-app`.
- Wire the login screen to `POST /api/v1/canonical-auth/login` on Railway.
  Use the bootstrap admin (`admin@acme.test` for tenant `acme`) for local
  testing.
- Use the JWT for subsequent calls; tenant_id is embedded in the token.
- Punch in / punch out endpoints will land later in `feat/attendance-canonical`
  (Phase 2). Stub them with mock data in the app until that ships.
- Geofence radius comes from `org.branches.geofence_radius_meters`
  (already in canonical schema, accessible via `GET /api/v1/hrms/branches`).

### Teammate 1 -- HRMS module
- Use the existing `apps/platform/src/modules/hrms/{Employees,Attendance,Leave,Payroll}.tsx`
  page shells. Replace mock data with real calls to `/api/v1/hrms/*`
  (workforce APIs already work under canonical-prod).
- Backend side: extend `backend/modules/hrms-employee/` for any new entity
  fields. Migrations go in `db/canonical/V0??__hrms_<thing>.sql`.
- Every migration must enable + FORCE RLS and add a tenant_id-leading
  index. Run `scripts/schema_audit.sql` locally and paste the output in
  the PR.
- Permissions follow `hrms.<entity>.<action>`. Seed new permissions in
  the same migration.

### Teammate 2 -- CRM module
- First PR: pure scaffold. New `backend/modules/mod-crm/` Maven module
  with `parent` set to `backend/pom.xml`. Java package
  `com.unifiedtree.modules.crm`. Empty `@Configuration` class to confirm
  it compiles + the canonical scan picks it up. ONE migration that
  creates `crm` schema, seeds permissions `crm.lead.read`, `crm.lead.write`,
  `crm.deal.read`, `crm.deal.write`. Nothing else.
- Second PR: `crm.leads` table + Lead entity + LeadRepository + LeadService
  + LeadController under `/api/v1/crm/leads`. Tenant scoped via RLS.
- Use existing `apps/platform/src/modules/crm/{Leads,Customers,Deals}.tsx`
  page shells. Replace mock data with calls to `/api/v1/crm/*`.
- DO NOT add CRM business logic in the first PR. Get the wiring right
  first.

### Teammate 3 -- WhatsApp automation
- Own repo: `unifiedtree-whatsapp-worker`. Language flexible (Node/Go/etc).
- First milestone: read TEAM_HANDOFF.md sec.6 events list, write a design
  doc proposing the transport (Kafka topic vs HTTP webhook) and the
  authentication strategy (service account JWT? signed webhook secret?).
  Submit as a markdown PR to THIS repo for backend-lead review.
- DO NOT add code to `backend/` until that design is signed off. The
  WhatsApp worker calls the public backend API; it does not get embedded
  in the monolith.
- Until the transport is decided, the worker can prototype against a local
  mock backend that emits dummy events.

---

## 4. Hand-off constraints

1. **Everyone branches off `feat/canonical-foundation`** (the foundation
   commit pushed on 2026-05-20). NOT off `main`.
2. **No direct push to `feat/canonical-foundation`**. All work goes through
   PRs targeting that branch (or a new shared integration branch the
   backend lead opens).
3. **No one touches another owner's scope** without PR review from that
   owner.
4. **CI must be green on PR**: `mvn clean install -DskipTests`,
   `mvn -pl app/hrms-app test-compile`, `pnpm type-check`, `pnpm build`.
   The current `.github/workflows/ci.yml` is on the dirty Tier 2 list --
   the backend lead needs to land that on a separate PR before teammates'
   PRs hit a non-green CI.
5. **Migrations are append-only.** Never edit an already-merged V*.sql.
   New work = new V0??__*.sql file with the next sequential number.

---

## 5. Open questions for each owner (answer before starting)

- **Teja**: Is the Expo app a brand-new repo or a re-do of the existing
  mobile attendance app? If the latter, identify which existing code is
  reusable.
- **Teammate 1**: HRMS module is large. Slice priority: directory first,
  attendance views second, leave third, payroll last? Confirm with
  product (you / the CEO).
- **Teammate 2**: CRM lead pipeline = single sales pipeline or per-team?
  Affects schema. Worth a 1-page design doc before the second PR.
- **Teammate 3**: Which WhatsApp Business API (Meta direct, Twilio, Gupshup,
  WATI)? Affects auth model and rate limits.

---

## 6. What NOBODY does until the backend lead opens it

- Attendance canonical APIs (Phase 2). Schema is ready (`attendance.records`
  partitioned monthly), but the service/controller layer is not.
- Leave canonical APIs (Phase 2). Same shape.
- Audit writer (Phase 3).
- The Stripe/Razorpay billing flow.
- The `apps/admin` real-data dashboards (GlobalUsers, Revenue, etc.).
- The legacy `com.hrms.api.saas` controllers -- they get DELETED once
  the new `com.unifiedtree.saas` module ships (see
  WEBSITE_ADMIN_GAP_MATRIX.md).
