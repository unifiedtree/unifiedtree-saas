# UnifiedTree -- Team Handoff

How four people can work on this codebase in parallel without breaking each
other. Read this once before your first PR.

---

## 1. Architecture in one sentence

UnifiedTree is a **modular monolith** Spring Boot backend (`backend/`) plus a
**pnpm monorepo** of separately-deployed frontend apps (`apps/website`,
`apps/platform`, `apps/admin`, `apps/employee`).

Backend modules share one Postgres database, one auth/RBAC stack, one tenant
isolation mechanism (Row-Level Security). They do NOT share controllers,
services, or DTOs across module boundaries -- they communicate via Spring
events when they need to talk.

```
SaasWeb/
+-- backend/                      one Maven multi-module project, one deploy
|   +-- app/                      bootable Spring Boot app + REST surface
|   +-- platform/                 cross-cutting: auth, RBAC, tenant, audit, settings, notification
|   +-- modules/                  business modules: hrms-attendance, hrms-employee, hrms-leave, ...
|   `-- shared/                   DTOs, events, security utilities (no business logic)
+-- apps/                         pnpm workspace, each app a separate deploy
|   +-- website/                  public marketing + signup/login
|   +-- platform/                 logged-in tenant workspace shell
|   +-- admin/                    UnifiedTree platform admin
|   `-- employee/                 ESS / mobile-friendly self-service
`-- packages/                     shared frontend libraries (sdk, ui-kit, utilities)
```

---

## 2. Module ownership

Four owners. See `TEAM_MODULE_SPLIT.md` for the detailed per-owner playbook.

| Owner | Scope | Files they touch |
|---|---|---|
| **Teja** (you, also backend lead) | Attendance App (Expo / mobile) in a separate repo, plus the attendance canonical backend later. Owner of `platform/`, `shared/`, `db/canonical`, deploy on the backend side. | Mobile repo (TBD). Backend: `backend/platform/**`, `backend/shared/**`, `backend/app/**`, `backend/modules/hrms-attendance/**`, `backend/**/db/canonical/**`, `backend/Dockerfile`, `backend/railway.toml`, top-level docs |
| **HRMS teammate** | HRMS module: workforce directory, employees, departments, designations, leave canonical | `backend/modules/hrms-employee/**`, `backend/modules/hrms-leave/**`, `backend/app/hrms-api/.../api/workforce/**`, `apps/platform/src/modules/hrms/**` |
| **CRM teammate** | New CRM module inside the monolith. Scaffold is already in place at `backend/modules/mod-crm/` (see its README.md for the contract). | `backend/modules/mod-crm/**`, `backend/app/hrms-api/src/main/java/com/hrms/api/crm/**` (new), `backend/**/db/canonical/V0??__crm_*.sql` (new), `apps/platform/src/modules/crm/**` |
| **WhatsApp automation teammate** | Separate worker/service that talks to backend via API + events. NO backend code until event contracts are signed off. | Own repo (TBD). Touches `backend/` only via documented event contracts (see sec.6). |

The four customer-facing frontend apps (`apps/website`, `apps/platform`,
`apps/admin`, `apps/employee`) plus `packages/` are coordinated work --
each owner edits their own module's pages but the frontend lead /
backend lead reviews any change to shared shell code (layouts,
auth store, ModuleGate, sdk).

> "Free hand" means free hand **inside your scope**. Touching another scope
> needs a PR review from that owner.

---

## 3. Hard rules every module must follow

1. **Every business table is tenant-scoped.**
   Add `tenant_id UUID NOT NULL`. Add an index that starts with `tenant_id`.
   Enable RLS: `ALTER TABLE x ENABLE ROW LEVEL SECURITY; ALTER TABLE x FORCE ROW LEVEL SECURITY;`
   Attach a policy: `CREATE POLICY tenant_isolation_x ON x USING (tenant_id = current_tenant_id());`

2. **Never bypass `TenantContext`.** Don't `SELECT ... WHERE tenant_id = ?` manually;
   trust RLS. If you find yourself needing to bypass, talk to the backend lead
   first -- there's almost always a wrong design choice upstream.

3. **Permissions are codes, not roles.** Endpoints gate with `@PreAuthorize("hasAuthority('module.entity.action')")`,
   not `hasRole(...)`. New permission codes go in `db/canonical/V0??__seed_perms.sql`
   and must follow `<module>.<entity>.<action>` shape (e.g., `crm.lead.write`).

4. **No new database in production.** Every module uses one of the existing
   canonical schemas (`platform`, `auth`, `rbac`, `org`, `hrms`, `attendance`,
   `leave_mgmt`, `settings`, `audit`) or proposes a new one in a design doc
   reviewed by the backend lead.

5. **No secrets in the repo.** `.env*` is gitignored; verify with `git check-ignore`
   before adding any new env file.

6. **Production migrations run as `ut_migrator`, app runs as `ut_app`.**
   See `backend/RAILWAY_DEPLOYMENT.md`. Don't disable RLS to make local dev
   easier -- set the dev tenant context in your boot config.

---

## 4. Adding a new module (the CRM playbook)

1. Add a Maven module `backend/modules/mod-crm/` with parent set to `backend/pom.xml`.
2. Java package: `com.unifiedtree.modules.crm.<entity>.{entity, repository, service, dto}`.
3. Add controllers in `backend/app/hrms-api/src/main/java/com/hrms/api/crm/` (canonical REST surface lives in `hrms-api`).
4. Write your migration in `backend/app/hrms-app/src/main/resources/db/canonical/V0??__crm_<entity>.sql`.
   - Create schema if new: `CREATE SCHEMA IF NOT EXISTS crm;`
   - Define table with `tenant_id` + audit columns (see existing V005 for the shape).
   - Enable + FORCE RLS.
   - Add policy.
5. Seed permissions in the same migration.
6. Re-run `scripts/schema_audit.sql` locally; sections 1-5 + 7 must stay empty.
7. Add tests under your module: `*Test.java` for unit, `*IT.java` for integration.
8. PR review required from backend lead before merge.

---

## 5. Deploy boundaries

| Surface | Deploys to | Root | Notes |
|---|---|---|---|
| Backend | Railway service | `backend/` | Dockerfile + `railway.toml` already in place. Set `DB_URL`, `DB_USERNAME=ut_app`, `DB_PASSWORD`, `UNIFIEDTREE_JWT_SECRET`, `UNIFIEDTREE_ALLOWED_ORIGINS`. First deploy only: `UNIFIEDTREE_BOOTSTRAP_*`. |
| Migrations | One-shot Railway job | `backend/` | Same image, `DB_USERNAME=ut_migrator`, `SPRING_FLYWAY_ENABLED=true`. Run once per release. |
| `apps/website` | Vercel/Netlify/Railway static | `apps/website/` | Set `VITE_API_URL=https://<backend-host>/api`. |
| `apps/platform` | Vercel/Netlify/Railway static | `apps/platform/` | Same. |
| `apps/admin` | Vercel/Netlify/Railway static | `apps/admin/` | Same. |
| `apps/employee` | Vercel/Netlify/Railway static | `apps/employee/` | Same. |
| Mobile attendance app | Expo/EAS | separate repo (TBD) | Talks to backend via the public API base URL. |
| WhatsApp automation | Separate service (TBD) | separate repo | Subscribes to events listed in sec.6; writes back via authenticated API calls. |

The four frontend apps share `packages/` (sdk, ui-kit, utilities) via pnpm
workspace symlinks. Don't add a fifth app without a reason.

---

## 6. WhatsApp automation -- event contract (no implementation yet)

The WhatsApp service is **not** a backend module. It is a separate worker
that subscribes to outbound events from the backend and calls the public
API for any writes it needs.

Events the backend will eventually publish (none implemented yet -- design
phase only):

| Event | Payload | When |
|---|---|---|
| `employee.created` | `{tenantId, employeeId, email, phone, joiningDate}` | After successful employee onboarding |
| `leave.approved` | `{tenantId, employeeId, leaveRequestId, from, to, leaveType}` | After leave is approved |
| `attendance.missed` | `{tenantId, employeeId, expectedDate}` | Daily cron, employees with no check-in |
| `otp.requested` | `{tenantId, employeeId, phone, otp, expiresAt}` | On OTP request for biometric / login flow |

Transport TBD (Kafka topic vs HTTP webhook). The WhatsApp owner proposes the
transport in a design doc reviewed by the backend lead.

**Until the design is signed off, the WhatsApp owner does NOT add code to
`backend/`.** They prototype in their own repo against a mock API.

---

## 7. Branching + PR gates

- `main` -- protected. No direct pushes.
- Feature branches: `feat/<scope>-<short-desc>`. Examples:
  - `feat/canonical-foundation` (this initial commit)
  - `feat/crm-leads`
  - `feat/website-pricing-page`
- PR review required from the matching scope owner:
  - Anything in `backend/platform/`, `backend/shared/`, `backend/**/db/canonical/`, deploy config -> backend lead.
  - Anything in `backend/modules/mod-crm/` -> CRM teammate (with backend lead courtesy review on the migration).
  - Anything in `apps/` or `packages/` -> frontend teammate.
- CI must be green: `mvn clean install -DskipTests`, `pnpm type-check`, `pnpm build`.
- If the PR touches a migration, the PR author also runs `scripts/schema_audit.sql`
  against a fresh local DB and pastes the output (sections 1-5 + 7 must be empty).

---

## 8. Local dev quickstart

```bash
# Backend
cd backend
docker compose up -d postgres   # or use your local Postgres
SPRING_PROFILES_ACTIVE=canonical DB_URL=jdbc:postgresql://localhost:5432/unifiedtree \
  DB_USERNAME=postgres DB_PASSWORD=postgres \
  ./run_app.bat   # or: mvn -pl app/hrms-app spring-boot:run

# Frontend (any one app)
cd apps/website
pnpm install
pnpm dev
```

The `canonical` profile loads the dev seed (demo admin/reader at
`admin@hrms.test` / `Hrms@12345`). The `canonical,canonical-prod` combo
(production posture) does NOT load dev seed.

---

## 9. What is not done yet

Read `backend/FEATURE_GAP_MATRIX.md` and `backend/RAILWAY_DEPLOYMENT.md` sec.5
for the full list. Highlights:

- `/v1/canonical-auth/refresh` endpoint not implemented yet.
- Audit writer (`audit.events`) schema ready, emitter pending.
- Per-tenant rate limiting wired but not enabled.
- Partition rotation cron not wired (current window ends 2026-08).
- Docker integration tests (`*IT.java`) compile clean but have not been run
  in CI yet -- they need a Docker-equipped runner.

Phase 2 (attendance + leave canonical APIs) has NOT started. Don't pick it
up until the backend lead opens it.
