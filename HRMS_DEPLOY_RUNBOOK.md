# HRMS Pilot-Readiness Sprint — Deploy Runbook

**Date prepared:** 2026-06-16
**Change set:** HRMS audit P0/P1s (`HRMS_AUDIT.md`, code-only) + Letter Distribution + audit-write fix + payroll pre-pilot fix sprint. **Four migrations `V058`→`V061`** — see §2.
**Status: NOT DEPLOYED.** This is a checklist. Do not deploy without a human owner (per the deploy-discipline agreement). Backend deploy writes to the **Railway production DB**.

---

## 1. What changed (27 files, code-only)

**Backend (11 files):**
- `LeaveController` — exposed `PUT /v1/leave/types/{id}` + `DELETE /v1/leave/types/{id}` (service logic already existed); added apply-time approver fallback to department head.
- `OnboardingController` + `OnboardingService` + `OnboardingInstanceRepository` — `GET /v1/onboarding/instances`, `DELETE /v1/onboarding/templates/{id}` (archive), `listInstances`, `archiveTemplate`, `findAllByOrderByCreatedAtDesc`.
- `WorkforceController` + `CompanyService`/`DesignationService`/`DepartmentService` + `WorkforceDtos` — `PUT /companies/{id}`, `PUT /designations/{id}`, `PATCH /departments/{id}/head`; new `UpdateCompanyRequest`/`UpdateDesignationRequest`; `dateOfBirth`/`gender` added to `UpdateWorkforceEmployeeRequest`.
- `WorkforceEmployeeService` — map DOB/gender on update.

**Frontend (16 files):** EmployeeForm (manager picker, zero-company guard, DOB/gender on edit), LeaveTypes (edit/deactivate), OrgSetup (company edit+delete, designation edit, dept-head picker), SalaryComponents (add/edit), GeneratedLetters (employee picker + deep-link), onboarding Instances/Templates/TemplateDetail (list + edit + archive), nav (Analytics/Files removed → ComingSoon; HR_MANAGER added to Salary Components), API hooks.

## 2. Database migrations — **FOUR**, applied as one migrator pass

> ⚠️ **UPDATED 2026-06-16 (payroll fix sprint).** This deploy is **NOT
> migration-free**. It now carries **four** migrations (`V058`→`V061`) from three
> change sets. Railway runs the app with `SPRING_FLYWAY_ENABLED=false` and
> `DB_USERNAME=ut_app` (the constrained, RLS-bound role — see
> `RAILWAY_DEPLOYMENT.md §1`). Migrations are therefore applied **out-of-band as
> `ut_migrator`** (owns tables + `BYPASSRLS`), **all four in one pass, in version
> order, before the app runs the new code.** Do **not** split this into multiple
> migrator runs and do **not** deploy the new backend until all four are present.

### 2.1 The four migrations

| # | Migration | What it does | Pairs with code |
|---|---|---|---|
| 1 | `V058__letter_distribution.sql` | `CREATE TABLE letters.distribution_jobs` + `letters.distribution_recipients` (+ RLS ENABLE/FORCE, indexes, grants) | Letter Distribution backend/FE |
| 2 | `V059__letter_distribution_permission.sql` | Seeds `hrms.letters.distribute` into `rbac.permissions`; grants it to `SUPER_ADMIN` + `HR_MANAGER` only | Letter Distribution `@PreAuthorize` |
| 3 | `V060__fix_audit_actor_ip_type.sql` | `audit.events.actor_ip` `inet → varchar(45)` (fixes platform-wide audit-write failure) | `AuditEvent` entity (`actor_ip` varchar + `diff` `@JdbcTypeCode(JSON)`) |
| 4 | `V061__payroll_runs_skipped_count.sql` | `ALTER TABLE payroll.runs ADD COLUMN skipped_employee_count INTEGER NOT NULL DEFAULT 0` | Payroll fix sprint (`PayrollRunService`, `/runs/{id}/skipped`) |

**Per-migration: purpose · what breaks if NOT applied · post-apply probe · rollback**

**V058 — distribution tables**
- *Purpose:* storage for bulk-letter jobs + per-recipient send rows.
- *If not applied (but new code deployed):* every Letter Distribution call 500s — `relation "letters.distribution_jobs" does not exist`. Letter generate/preview is unaffected.
- *Probe:* `SELECT to_regclass('letters.distribution_jobs'), to_regclass('letters.distribution_recipients');` → both non-null. RLS on: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('distribution_jobs','distribution_recipients');` → `t/t` for both.
- *Rollback:* `DROP TABLE letters.distribution_recipients; DROP TABLE letters.distribution_jobs;` (recipients first; FK is `ON DELETE CASCADE`). **Destructive if any distribution rows exist** — at pilot there are none, so it's clean.

**V059 — distribute permission**
- *Purpose:* RBAC permission + role grants for the Distribute action.
- *If not applied:* `hasAuthority('hrms.letters.distribute')` is false for everyone → Distribute endpoints 403, and the SDK `<Can>` gate hides the button. Distribution is unusable even with V058 present.
- *Probe:* `SELECT r.code FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id WHERE rp.permission_code = 'hrms.letters.distribute' ORDER BY r.code;` → exactly `HR_MANAGER`, `SUPER_ADMIN` (two rows, no `FINANCE_LEAD`).
- *Rollback:* `DELETE FROM rbac.role_permissions WHERE permission_code='hrms.letters.distribute'; DELETE FROM rbac.permissions WHERE code='hrms.letters.distribute';` — non-destructive.

**V060 — audit actor_ip type**
- *Purpose:* fixes the platform-wide audit-write outage (Hibernate binds varchar; column was `inet`).
- *If not applied (but new `AuditEvent` entity deployed):* every audited write fails the type bind. The defensive try/catch added during the letters work swallows it, so the app keeps working but **`audit.events` silently stays empty** (compliance gap). **Must ship with the entity change** — column and code together, or audit stays broken either direction.
- *Probe:* `SELECT data_type FROM information_schema.columns WHERE table_schema='audit' AND table_name='events' AND column_name='actor_ip';` → `character varying`. **Functional:** perform one audited action via the app, then `SELECT count(*) FROM audit.events WHERE created_at > now() - interval '5 minutes';` → `> 0` (this is the real proof — mirrors the local 0→7 verification).
- *Rollback:* `ALTER TABLE audit.events ALTER COLUMN actor_ip TYPE inet USING actor_ip::inet;` — reversible **only if every stored value parses as inet**, and you must redeploy the old entity at the same time or audit re-breaks. Prefer redeploy-old-build over reverting this column.

**V061 — payroll skipped count**
- *Purpose:* persists the count of employees skipped (no salary structure) per run; backs the run-detail banner.
- *If not applied (but new payroll code deployed):* **load-bearing — payroll breaks.** `processRun`'s rollup `UPDATE … SET skipped_employee_count = ?` and `toRunDto`'s `rs.getInt("skipped_employee_count")` both reference the column; missing column → `processRun`, `getRun`, and `listRuns` all 500. This is not optional polish.
- *Probe:* `SELECT data_type, column_default FROM information_schema.columns WHERE table_schema='payroll' AND table_name='runs' AND column_name='skipped_employee_count';` → `integer`, default `0`.
- *Rollback:* `ALTER TABLE payroll.runs DROP COLUMN skipped_employee_count;` — reversible, non-destructive (must redeploy old payroll code too).

### 2.2 🚨 Grant gotcha — `ut_app` access to the NEW `letters` tables

`V058`'s grant block only grants to `app_user`/`hrms_app` **if those roles exist** (it mirrors the V032 letters convention). **Those are the local/Docker/test role names — Railway's app role is `ut_app`, which the block does not grant.** The documented `ut_app` default-privilege loop in `RAILWAY_DEPLOYMENT.md §1` covers `platform, auth, rbac, org, hrms, attendance, leave_mgmt, settings, audit` — it does **not** list `letters`. So after V058 creates the tables as `ut_migrator`, **`ut_app` will get `permission denied for table distribution_jobs` at runtime** unless default privileges were set for the `letters` schema previously.

**Required after the migrator pass, before the app serves traffic** (run as the DB owner or `ut_migrator`):
```sql
GRANT USAGE ON SCHEMA letters TO ut_app;   -- harmless if already held
GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_jobs       TO ut_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_recipients TO ut_app;
-- so future letters.* tables auto-grant and you never hit this again:
ALTER DEFAULT PRIVILEGES FOR ROLE ut_migrator IN SCHEMA letters
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ut_app;
```
*Verify:* `SET ROLE ut_app; SELECT count(*) FROM letters.distribution_jobs; RESET ROLE;` → returns `0`, not `permission denied`.

> Note: V059 (rbac DML), V060 (audit column), V061 (payroll column) are all changes to **existing** tables `ut_app` already accesses — **only new tables need new grants**, so only V058 is exposed here. (If payroll has never run on Railway, also confirm `ut_app` can read `payroll.runs` at all — same probe pattern.)

### 2.3 Pre-deploy checklist (run BEFORE touching prod)

- [ ] **Back up the prod DB** (Railway snapshot or `pg_dump`), and confirm the dump is restorable.
- [ ] **Check current migration state:** `SELECT version, description, success FROM flyway_schema_history_canonical ORDER BY installed_rank DESC LIMIT 20;` — confirm `V058`–`V061` are **absent**, note the highest present version, and judge whether history is **consistent** with what's physically applied (prior prod migrations were hand-applied with Flyway disabled, so it may not be — this decides §2.4 path A vs B).
- [ ] **Confirm roles:** `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('ut_migrator','ut_app');` → `ut_migrator=t`, `ut_app=f`.
- [ ] **Confirm the Flyway toggle** is wired: app currently runs `SPRING_FLYWAY_ENABLED=false`; you can set it `true` on a `ut_migrator`-credentialed one-shot only (never on the `ut_app` service).
- [ ] **Have the four `.sql` files** from `backend/app/hrms-app/src/main/resources/db/canonical/` on hand (V058–V061).
- [x] **Canonical-path verified (2026-06-17):** all four V058–V061 live in `db/canonical` (the only location loaded under the `canonical-prod` profile, per `application-canonical-prod.yml: locations: classpath:db/canonical`); **none** are in any legacy `db/migration` path, and the local canonical history table records all four with correct script names. ⚠️ A migration placed in `db/migration` instead of `db/canonical` would apply locally/in tests but **silently skip on Railway** (prod loads `db/canonical` only) — same failure class as the `ut_app` grant gap. Re-verify with `find backend -path '*/target/*' -prune -o -name 'V06*.sql' -print` if new migrations are added.

### 2.4 Apply — ONE migrator pass, all four, in order

Pick the path by what §2.3 found about `flyway_schema_history_canonical`:

**Path A — psql hand-apply (recommended; matches current Flyway-disabled prod).** Connect `psql` **as `ut_migrator`** and run, in a single session, **in this order**:
```
\i V058__letter_distribution.sql
\i V059__letter_distribution_permission.sql
\i V060__fix_audit_actor_ip_type.sql
\i V061__payroll_runs_skipped_count.sql
```
Then run the §2.2 grant block. Optionally insert matching `flyway_schema_history_canonical` rows so a future Flyway-enabled run stays consistent.

**Path B — one-shot Flyway migrator deploy (only if history is consistent).** Deploy a one-shot with `DB_USERNAME=ut_migrator`, `DB_PASSWORD=<#1>`, `SPRING_FLYWAY_ENABLED=true`, `ddl-auto=validate`; Flyway applies V058–V061 in version order and records them. Then run the §2.2 grant block.

Either path: **all four land before the app runs new code**, then the app stays on `DB_USERNAME=ut_app` with Flyway disabled. Code↔migration pairing is mandatory — V060 with the `AuditEvent` entity change, V061 with the payroll code. The HRMS P0/P1 code in §1 adds no schema of its own; these four are the only schema changes, all additive/low-risk, dry-run-validated + verified on the local DB (and V061 proven by `PayrollFreshTenantIT` + the canonical migration run in CI).

## 3. Pre-deploy verification (DONE locally)
- ✅ Backend `mvn compile` — exit 0
- ✅ Frontend `tsc --noEmit` — exit 0
- ✅ Boot on local DB + login + `GET /onboarding/instances` 200 + leave-type create/update/delete round-trip (201 / PUT ok / 204, drops from active list)

**Recommended before deploy:** click-walk the P0 flows in the local app (it's running now — backend new code on local DB 5433, platform at http://demo.localhost:3001):
1. Add Employee with **no company** → blocked with a clear message (P0-2).
2. Add Employee → pick a **Reporting Manager** → that employee applies leave → it appears in the manager's Approvals (P0-1).
3. Leave Types → **edit** an entitlement, **deactivate** a type (P0-3).
4. Org Setup → edit a company, set a **department head**; Salary Components → **add** one; Letters → **Generate** picks an employee from a dropdown.

## 4. Deploy steps (gated — human owner runs these)
Mechanics live in `backend/RAILWAY_DEPLOYMENT.md` and root `DEPLOY.md`; this sprint adds **no new** deploy steps because there's no migration.
1. **Branch + PR + review** the 27-file diff (don't push straight to the deploy branch).
2. **Backend → Railway:** trigger your existing Railway build/deploy for the backend service. No env-var changes, no SQL. Watch the deploy log for `Started HrmsApplication` and a healthy `/api/actuator/health`.
3. **Frontend → Vercel:** deploy the `platform` app (existing Vercel pipeline). No new env vars.
4. Order doesn't matter (no breaking API changes — all additions), but backend-first is conventional.

## 5. Post-deploy smoke (against production)

**5.0 Migration verification — run the moment the §2.4 pass completes, before the app serves users.** Run the four per-migration probes in §2.1 (each must return its expected result) **and** the §2.2 `ut_app` grant check. All green = schema ready for the app deploy. If any probe fails, stop and fix before flipping the app to the new code.

**5.1 Feature smoke** — run the same checks that passed locally, against the prod URLs:
- Login as a **real** Railway account.
- `GET /api/v1/onboarding/instances` → 200.
- Create → edit → deactivate a **throwaway** leave type (then leave it deactivated).
- Add a test employee with a manager → apply leave as them → confirm it lands in the manager's approval queue → approve → balance updates. **This is the P0-1 acceptance test — do it on prod.**
- Confirm Analytics/Files no longer appear in the sidebar.
- **Letter Distribution (V058/V059):** as HR_MANAGER, create a small distribution to 1–2 **test** recipients → job reaches a terminal status and recipients show SENT/FAILED; confirm FINANCE_LEAD does **not** see the Distribute action.
- **Payroll (V061):** open a processed run that had a structure-less employee → the amber "N skipped" banner + View-list modal render. (Negative-net gate is covered by `PayrollFreshTenantIT`; no need to engineer it on prod.)
- **Audit (V060):** after the above actions, `SELECT count(*) FROM audit.events WHERE created_at > now() - interval '10 minutes';` → `> 0` (the real audit-persistence proof on prod).

## 6. Rollback
**Schema is now in play — the old "just redeploy, nothing to reverse" note no longer fully holds.** The four migrations are additive/low-risk, so leaving them in place is usually safe; **prefer roll-forward over reversing schema.**
- **Code:** redeploy the previous backend build (Railway: redeploy prior deployment) / promote the previous Vercel deployment.
- **V060 caveat:** the old build's `AuditEvent` maps `actor_ip` as `inet`; with the column now `varchar(45)`, the old build may fail `ddl-auto=validate` at boot. If you'd be rolling back across V060, roll **forward** instead — or also reverse V060 (§2.1, requires inet-clean data, and audit returns to its prior broken state).
- **If you must reverse schema:** apply the §2.1 reverse DDL in reverse order **V061 → V060 → V059 → V058**. V061/V060/V059 are clean; **V058's drop is destructive** if any distribution rows exist (none at pilot). Leave the `ut_app` grants from §2.2 — they're harmless.

## 7. Deferred (NOT in this deploy) — backlog
- **P1-1 grade/shift on employee** (the one deferred critical item): needs `ALTER TABLE hrms.employees ADD COLUMN grade_id uuid, ADD COLUMN shift_id uuid;` plus entity/DTO/service/FE wiring. Because Railway runs Flyway disabled, that future deploy **will** require running the ALTER manually on Railway before/with the code. Deferred here to keep this deploy migration-free. Grade/shift aren't consumed by payroll/attendance yet, so the only current impact is those two dropdowns not persisting.
- Other P2 items remain in `HRMS_AUDIT.md` (profile-section inline edits, L1/L2 leave chain, attendance manual-entry UI, invitation revoke, bulk-import template).

## 8. Current local state (FYI)
- Backend is running the **new code against the LOCAL Docker DB (5433)** — your browser app at `:3001` currently talks to local data, not Railway.
- To put the local app back on **Railway prod data** (old code) before deploying: re-run `backend/run_spring.ps1`. To deploy the new code to Railway: follow §4.
