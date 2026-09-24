# HRMS backend handoff — 2026-09-24 (read this first)

This supersedes the runtime/status/inventory sections of `HRMS_CLAUDE_HANDOFF.md` (dated
2026-09-23). That file's **section 1 (mission and constraints)** and **section 3 preservation
rules** still apply and are restated below; its runtime/status details are stale — use this
document for anything current. `HRMS_IMPLEMENTATION_STATUS.md`,
`HRMS_MODULE_ACTION_LEDGER.md` and `HRMS_FUNCTIONALITY_AUDIT.md` are the detailed evidence
trail behind the summary here — read them when you need the "why", not to re-derive state.

The person picking this up: keep going on the backend/gaps track. The project owner is using
Claude Design (claude.ai/design) in parallel to design pages — that track is separate, already
complete for its own scope (see §9), and not something you need to touch.

## 0. TL;DR

- Everything described here is now on `main` (pushed by this handoff — see §10 for the exact
  commit). `git pull` gets you all of it.
- The DB schema/migrations are current (Flyway at V141) but the **local Postgres data
  directory itself lives outside the repo** (`%LOCALAPPDATA%\UnifiedTreeRecovery`), so it does
  NOT come across in the pull. You build your own local recovery environment (§2) and reseed
  demo data (§2.4). You're starting a fresh local database, not picking up an existing one.
- **Before you start, get three untracked files from the project owner** (§2.2). The most
  important is `scripts/recovery-company-owner.sql`. It creates the owner login that every
  evidence script uses.
- Three client-reported complaints (C1 late-drilldown, C2 shift effective dates, C3
  requesters-shown) are the north star — see §1. C1 and C2 are fixed and live-verified. C3 is
  partially covered by finished work (shift-request approvals) but not fully closed.
- A batch of 10 UI/backend gap items was mid-flight when the machine this was built on
  rebooted. Their real state (not "done", not "broken" — a spectrum) is in §5. Read it before
  assuming any of them work or don't.
- 4 business decisions were already made by the project owner and are binding — §7. Don't
  re-litigate them or invent alternatives.
- Priority order and rough effort for what's left is in §8.

## 1. Mission and non-negotiable constraints (carried over, still binding)

Complete the HRMS in the **existing** UnifiedTree-branded platform UI and backend — this is not
a rewrite and not a return to an abandoned separate prototype. Company admin is the primary
user (distinct from the SaaS platform super-admin). Scope is every reachable module, its
settings, role gating, frontend actions, APIs, validation and persistence — not just a fixed
endpoint list.

Keka was a **layout/navigation reference only** — never copy its colors, wordmarks, or content.
The UnifiedTree brand (emerald palette, existing component system) is fixed; see the design
memory notes referenced in this repo's design docs if you touch shared UI primitives.

The four original client acceptance cases (do not lose sight of these — they are why this
project exists):
1. "One person is late" must identify **who** (name, not just a count).
2. A shift change must persist with the **correct effective date**, not silently apply today.
3. Every issue/request must show **who raised it**, with a real, permitted decision workflow.
4. Every visible control must do a real, permitted action with proper loading/empty/error/success
   states — no dead buttons, no fabricated success.

Standing rules:
- The user has already authorized local implementation and demo/test data. Don't ask again to
  do routine authorized work — ask only for real missing business decisions or external
  credentials/config.
- Do not casually rewrite stable payroll/leave/auth/onboarding logic, invent business rules that
  weren't specified, disable security checks, fabricate provider success, silently auto-retry
  ambiguous email sends, or declare "zero bugs" / "production ready" without live evidence.
- Never mutate production data. All testing is against the **local recovery** stack only
  (§2) — never the deployed API.
- Vite **defaults to the deployed/production API** unless you explicitly override it. Always
  export `VITE_PROXY_TARGET`, `VITE_API_URL`, `VITE_API_BASE_URL` before starting the dev server
  (§2.3). Otherwise you'll be testing against prod without realizing it.
- Git: commit and push each verified checkpoint to `main`, scoped to your own files. Never
  commit `.claude/` or the three password-bearing recovery scripts (they hold a local DB
  password and a JWT signing secret): `scripts/recovery-company-owner.sql`,
  `scripts/start-recovery-backend.ps1`, `scripts/test-recovery-backend.ps1`. These three exist
  locally (untracked); get copies from the project owner privately. See §2.2.
- Don't lock/process a real payroll run casually — it's flagged in the codebase as a
  high-risk, real-financial-side-effect action and is deliberately left unautomated in test
  seeding.
- GCP/production deploy is out of scope for this track entirely. There are two independent
  deploy mechanisms (`.github/workflows/gcp-backend-deploy.yml` via Cloud Run + Workload
  Identity Federation, and `.github/workflows/cd-production.yml` via SSH + docker compose on
  version tags) but production DB migrations are explicitly **manual**
  (`docs/production/RUNBOOK.md` §5 — Flyway is disabled in prod). None of this needs touching
  for the work in this document.

## 2. Local runtime setup (do this first)

You are setting this up fresh on your own machine — the previous local recovery stack lived
only on the machine that produced this handoff and is not transferable.

### 2.1 Ports and identities

| Component | Address | Notes |
|---|---|---|
| Frontend | `http://demo.localhost:3002` | Vite dev server |
| API | `http://127.0.0.1:8080/api` | Spring Boot, `canonical`/`canonical-prod` profile |
| PostgreSQL | `127.0.0.1:55432` / db `unifiedtree_recovery` | Role `ut_app`, RLS enforced |
| Local SMTP catcher | `127.0.0.1:11025` | Never relays externally |
| Local mail inbox UI | `http://127.0.0.1:18025` | View captured mail |

Demo identities (local test password `Hrms@12345`; scripts accept `RECOVERY_PASSWORD` to override):
- Tenant `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, company `cccccccc-cccc-cccc-cccc-cccccccccccc`.
- **Committed, arrive with the pull** (Flyway `db/dev-seed`, V900–V904): `admin@`, `hrm@`,
  `mgr@`, `fin@`, `reader@unifiedtree.demo`. `reader@` is the employee-scope login, employee id
  `22222222-2222-2222-2222-222222222222`.
- **Not committed:** `owner@unifiedtree.demo`, the company-owner login (employee id
  `11111111-1111-1111-1111-111111111111`, workforce email `admin@unifiedtree.demo`, so search the
  employee picker by that address). It's created by `scripts/recovery-company-owner.sql`, one of
  the three excluded files. **Every `live-*.mjs` evidence script logs in as this owner**, so you
  need that file. Get it from the project owner directly, not through git.

### 2.2 Files you need from the project owner (not in git)

These three files stay out of git because they contain a local DB password and a JWT signing
secret. Ask the project owner to send them privately:
- `scripts/recovery-company-owner.sql`: adds the owner login, its roles, module entitlements and
  a local test subscription (no payment provider is contacted).
- `scripts/start-recovery-backend.ps1`: the backend launcher.
- `scripts/test-recovery-backend.ps1`: an older broad test runner that works on a copied source
  tree. Read it before using it; its `robocopy /E` does not delete stale files.

If you'd rather write your own launcher, these are the settings it passes (names only; use
your own values):
- Environment: `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `DATABASE_URL`, `UNIFIEDTREE_JWT_SECRET`,
  `UNIFIEDTREE_FACE_ENCRYPTION_KEY`, `UNIFIEDTREE_SUBSCRIPTION_GRANDFATHER_TENANT_IDS`.
- Arguments: `--spring.profiles.active=canonical,canonical-prod`,
  `--spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed` (this override is what
  loads the demo seed; `canonical-prod` alone does not), `--spring.flyway.url/user/password`,
  `--unifiedtree.mail.provider=smtp`, `--spring.mail.host=127.0.0.1`, `--spring.mail.port=11025`,
  `--unifiedtree.firebase.enabled=false`,
  `--unifiedtree.inspection.local-path=<runtime root>\inspection-documents`, `--server.port=8080`.

### 2.3 Bring up Postgres, mail catcher, backend, frontend

**Postgres.** `scripts/restart-recovery-postgres.ps1` expects a cluster to exist already at
`%LOCALAPPDATA%\UnifiedTreeRecovery\postgres` and only runs `pg_ctl start`. It does not create
one. First-time setup on a new machine:
1. Install PostgreSQL 18. The scripts hard-code `C:\Program Files\PostgreSQL\18\bin\`.
2. Run `initdb` on `%LOCALAPPDATA%\UnifiedTreeRecovery\postgres`. From then on,
   `scripts/restart-recovery-postgres.ps1` starts it on `127.0.0.1:55432`.
3. Create an empty database `unifiedtree_recovery` and a role `ut_app` (not a superuser, no RLS
   bypass).

**Mail catcher.** Run `node scripts/local-mail-catcher.mjs`. It listens for SMTP on 11025 and
serves the inbox on 18025, storing messages under `%LOCALAPPDATA%\UnifiedTreeRecovery\mail`.

**Backend.** Build from inside `backend/`:
```
mvn -pl app/hrms-app -am -DskipTests package -q
```
Then launch the jar with `scripts/start-recovery-backend.ps1 -JarPath
<repo>\backend\app\hrms-app\target\hrms-app-1.0.0-SNAPSHOT.jar`. `application-canonical.yml`
expects an empty database: on first boot Flyway builds every schema through **V141** and loads
the dev seed (V900+). You don't run migrations by hand. After that first boot:
1. Apply `scripts/recovery-runtime-grants.sql` as the superuser. It grants `ut_app` its runtime
   privileges on the local database only; it is not a production security migration.
2. Apply `scripts/recovery-company-owner.sql` to create the owner login.

**Frontend.** In Git Bash you must set `MSYS_NO_PATHCONV=1`. Without it, MSYS2 rewrites
`/api`-style variables to `file:///C:/Program Files/Git/api...` and every API call fails. (Login
hung until this was found.)
```
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'
export VITE_PROXY_TARGET=http://127.0.0.1:8080
export VITE_API_URL=/api
export VITE_API_BASE_URL=/api
pnpm --filter platform dev --host 0.0.0.0 --port 3002 --strictPort
```
PowerShell doesn't have the MSYS2 problem. Set the same three variables as `$env:` values
instead. **Whatever shell you use, don't skip the three `VITE_*` variables.** Without them Vite
sends every request to the deployed production API.

### 2.4 Reseed demo data

`apps/platform/e2e/recovery/seed-design-demo-data.mjs` is an idempotent, real-API-only seeder
(attendance check-ins, WFH requests, a shift-change request, an overtime record, company
notice, notification template, integration connection, expense policy, PLI target/award,
certified skill, performance goals, letter distribution, salary structures). Run it once your
backend/frontend are up and the owner/reader logins work, to get comparable demo state to what
was used for verification in this session. It logs in as the owner over the real API — no
direct DB writes.

## 3. What's done and live-verified (safe to build on top of, no need to re-check)

| Item | Evidence |
|---|---|
| C1 — late-arrival drilldown names who is late | `apps/platform/e2e/recovery/live-late-drilldown.mjs`, 8/8 |
| C2 — shift changes take effect on the chosen date, not immediately | `EmployeeShiftServiceTest` 4/4 (unit) + `apps/platform/e2e/recovery/live-shift-effective.mjs`, 12/12 (live) |
| `/hrms/fnf` route collision fixed with a dedicated `/hrms/exit` Resignation & Exit page | `apps/platform/e2e/recovery/live-exit-center.mjs`, 12/12 |
| Claude Design import (44 components, 40 previews, conventions doc) | separate track, done — see §9, not your concern |
| 85-page design brief pack + 235 real-app screenshots with seeded demo data | `docs/design-briefs/`, separate track — see §9 |

Full defect detail and the exact bug that was fixed for C2 (a subtle "in force today" vs "the
one open-ended row" semantics bug in shift resolution) is in
`HRMS_MODULE_ACTION_LEDGER.md` §1.

## 4. Backend features added 2026-09-24: unit-tested, NOT yet live-verified

These compile and pass unit tests (confirmed after this machine's restart) but were never
re-run against a live backend/frontend afterward. Treat them as "should work, unconfirmed",
not "done".

Four increments. All four have unit tests; none has been checked against a running system yet.

| Feature | What it is | Unit evidence | Live evidence script |
|---|---|---|---|
| Late-by minutes | `AttendanceService.getShiftWindowsForEmployees` feeds `shiftName/expectedCheckInAt/graceMinutes/lateByMinutes` onto `StaffStatusResponse` | `StaffStatusLateByTest` 2/2 | none yet — **and the UI column was never added**: only the TS type on `useAttendance.ts` was extended; `Attendance.tsx` does not render these fields. This is real remaining work, not just verification. |
| Workforce Directory CSV export | `GET /v1/hrms/employees/export.csv`, RFC-4180 + formula-injection guard, 10k-row cap, no salary/bank/identity columns | `EmployeeDirectoryCsvTest` 3/3 | `apps/platform/e2e/recovery/live-directory-export.mjs` written, never run live |
| Candidate → employee conversion | V140 migration + `POST /v1/hiring/candidates/{id}/convert`, one transaction, carries name/email/phone/dept/role/CTC from the accepted offer | `CandidateConversionServiceTest` 2/2 | `apps/platform/e2e/recovery/live-candidate-conversion.mjs` written (comprehensive: 409 on repeat, 422 on non-HIRED, 403 for employee role), never run live |
| Offer-email attempt ledger hardening | V141 migration; distinguishes "definitely not sent" (safe to retry) vs "uncertain" (blocks resend until an operator resolves it) vs accepted; new `GET/POST /v1/hiring/offers/{id}/email/attempts...` endpoints | `OfferDeliveryFailureTest` 5/5 (isolated in-memory harness, doesn't touch the shared mail catcher) | none written — this one has no browser-level e2e script at all yet |

**First thing to do**: get the local stack up (§2), rebuild the jar, and run the three existing
`live-*.mjs` scripts above plus manually exercise the offer-email attempt endpoints. Fix
whatever breaks before building on top of any of these.

## 5. Batch of 10 gap items — real per-item state (do not assume uniform status)

A background workflow ran 10 independent implement→verify items in parallel; the host machine
rebooted mid-run and killed the orchestrator. The file edits for each item are on disk (visible
in `git status`) and are part of this push, but **verification state differs per item** — check
this table before trusting any of them:

| Item | Files | Implementation self-check | Independent adversarial verify | Known backend gaps noted by the implementer |
|---|---|---|---|---|
| Leave calendar | `Leave.tsx`, `leave/LeaveCalendar.tsx`, `leave/useLeaveCalendar.ts` | 25/25 | **PASS_WITH_FIXES** — verifier found 3 issues (misleading truncation note, 2 weak checks) and applied the fixes itself | needs `GET /v1/leave/calendar?from&to[&departmentId]` — check whether this endpoint exists or was stubbed client-side |
| Shift-request approvals (C3-relevant) | `ShiftsAndOt.tsx`, `ShiftRequestApprovals.tsx`, `OvertimeApprovals.tsx`, `shiftTime.ts` | 22/22 | **PASS_WITH_FIXES** — verifier found 3 issues (stale card after a failed decision, script that could print a pass after a timeout, missing reject/role checks) and applied the fixes itself | none blocking — overtime intentionally has no payroll posting (§7 decision 1) |
| Money modals (advances/expenses) | `Expense.tsx`, `expense/expenseStatus.ts`, `expense/ReimbursementBatches.tsx`, `Advance.tsx`, `advance/AdvanceAdmin.tsx` | 18/18 | **not verified** | none noted |
| F&F tabs | `FullAndFinal.tsx`, `exit/ExitCenter.tsx` | 27/27 | **not verified** | `GET /v1/fnf/settlements` needs an optional `status` query param — check `FnfController#list` |
| Face-punch logs | `Attendance.tsx`, `attendance/face/useFacePunchLogs.ts`, `attendance/face/FacePunchTab.tsx` | 19/19 | **not verified** | `GET /v1/attendance/face/admin/events` has no date filter — needs `from/to` params on `FaceController.adminEvents`/`FaceService` |
| Compliance modals | `Compliance.tsx` | 20/20 | **not verified** | no DELETE endpoint for statutory filings/compliance items/POSH complaints on `ComplianceController` — a mistakenly scheduled filing can't be removed via UI |
| Staff dashboard | `HrmsDashboard.tsx` | 45/45 | **not verified** | "Mark Attendance" web punch-in/out needs a **product decision**, not just an endpoint (the check-in/check-out APIs already exist) — flag to the project owner, don't guess |
| Dead entrypoints (My Salary links from `/me` and `/me/payslips`, Work Time Settings from `/hrms/settings`, workspace Overview "Expenses" link) | `ess/EssDashboard.tsx`, `payroll/EmployeePayslips.tsx`, `probation/ProbationSettings.tsx`, `employees/workspace/EmployeeOverview.tsx`; script `live-dead-entrypoints.mjs` | **agent started, no completion result recorded before the restart** | not verified | unknown — inspect the diff from scratch |
| Attendance Analytics calendar | `analytics/AttendanceAnalytics.tsx` (large rewrite, ~370 lines changed); script `live-att-analytics-calendar.mjs` | **agent started, no completion result recorded before the restart** | not verified | unknown — inspect the diff from scratch |
| Truthful admin (Profile "(Static)" data, ModuleNotActivated USD prices, PayrollDashboard TDS honesty) | `pages/Profile.tsx`, `pages/ModuleNotActivated.tsx`, `payroll/PayrollDashboard.tsx`; **no evidence script was written** | **agent started, no completion result recorded before the restart** | not verified | unknown — inspect the diff from scratch; this may be half-finished |

For the last three rows: the workflow journal shows these agents were dispatched but never
logged a completion before the machine died. Don't assume the diffs on disk are finished or
even self-consistent — read them from scratch like you would review a stranger's WIP branch,
and re-run `pnpm --filter platform exec tsc --noEmit` (it reported 0 errors on the tree in this push) before trusting them further.

Where `live-*.mjs` scripts exist for a batch item (`live-money-modals.mjs`, `live-fnf-tabs.mjs`,
`live-face-punch-logs.mjs`, `live-compliance-modals.mjs`, `live-leave-calendar.mjs`,
`live-shift-requests.mjs`, `live-staff-dashboard.mjs`, plus the unconfirmed `live-dead-entrypoints.mjs` and `live-att-analytics-calendar.mjs` — all under
`apps/platform/e2e/recovery/`), they were written by the same agent that wrote the feature and
self-report the pass counts above. Re-running them is exactly how you get independent
confirmation for the "not verified" rows — that's the fastest path to real confidence here, not
re-reading the diffs cold.

## 6. C3 ("who raised it") — current honest state

Partially addressed, not closed:
- Shift-change requests now show the requester properly (part of the shift-request-approvals
  batch item above — pending its own live re-verification).
- `/hrms/exit` shows who started a resignation/notice (verified, §3).
- Not yet checked this round: attendance correction approvals (`GET
  /v1/attendance/corrections/approvals` returns the right shape but had zero pending fixtures
  to actually eyeball during the last check), leave approvals, WFH approvals, expense claim
  approvals. See `HRMS_MODULE_ACTION_LEDGER.md` §1 row C3 for the exact API shapes already
  confirmed.

## 7. Locked business decisions — do not re-ask, do not invent alternatives

1. **Overtime = approval-only.** Reviewed minutes are recorded; there is no payroll posting, no
   comp-off, no formula. The UI must say "Recorded, not paid."
2. **Providers = local only.** Keep the local mail catcher. No external sends of any kind.
   Integrations stays a truthful registry (don't fabricate connected-provider state).
3. **Inspector = signed, expiring links are sufficient.** OTP was explicitly dropped. Remaining
   inspector-adjacent work, if picked up, is scoped to muster export + document
   retention/audit policy — nothing else.
4. **Git = commit + push every verified checkpoint to `main`**, scoped to your own files, always
   excluding the three password-bearing scripts and `.claude/`.

## 8. Recommended next steps, in priority order

1. **Stand up your local stack (§2) and confirm the baseline still holds**: login works, the
   53-route owner sweep has no page errors (`apps/platform/e2e/recovery/live-browser.mjs`),
   Flyway is at V141.
2. **Re-run the unconfirmed batch `live-*.mjs` scripts (§5)** and the two written-but-never-run
   feature scripts (`live-directory-export.mjs`, `live-candidate-conversion.mjs`, §4). This converts most
   of "implemented, self-reported" into "independently confirmed" cheaply — do this before
   writing any new code, since a batch item can look done in the diff and still be broken live.
3. **Finish the 3 items with no completion record** (dead-entrypoints, att-analytics-calendar,
   truthful-admin) — read their diffs cold, finish or fix them, write/adapt a `live-*.mjs` for
   each, verify.
4. **Add the late-by UI column to `Attendance.tsx`** (§4 row 1) — the backend and TS type are
   ready, only the render is missing. Small, high-value, closes out plan item 5 under C1.
5. **Write a live e2e for offer-email attempt resolution** (§4 row 4) — no script exists yet;
   the isolated unit harness (`OfferDeliveryFailureTest`) proves the logic but not the live
   wiring (controller auth, actor extraction from JWT, real DB writes to
   `hiring_mgmt.offer_email_attempts`).
6. **Close out C3 properly** (§6) — attendance corrections, leave, WFH, expense approvals all
   need a requester-identity check with real pending fixtures, not just an API-shape check.
7. **Full regression sweep** — role-matrix (owner/HR/dept-manager/employee), tenant isolation,
   mobile layout. None of this has been run since today's changes landed; don't skip it before
   calling anything "done".

Rough sizing if you want a number: each batch-item re-verification is 15-30 minutes; the 3
unfinished items are 1-2 hours each depending on scope; the late-by column is under 30 minutes;
the offer-email live e2e is ~45 minutes; C3 closure is 1-2 hours; the regression sweep is
1-2 hours. None of this is designed to be rushed — verify live before marking anything done,
per §1's standing rule against declaring completion without evidence.

## 9. Design track (separate, not yours to touch)

The project owner is doing hands-on page design in Claude Design
(`https://claude.ai/design/p/00b3efa9-2fcf-413b-b54b-efd18bbbaccb`, project "UnifiedTree HRMS
Design System" — an older, incomplete project at `99ea22a9-3bb8-4c00-aa2a-6cd258e859bd` should
be ignored/deleted, not used). It's backed by:
- `docs/design-briefs/00-README.md` onward — 85 page briefs with ready-to-paste prompts.
- `docs/design-briefs/screenshots/{owner,employee,public}/*.png` — 235 real-app screenshots
  with seeded demo data, indexed in `docs/design-briefs/screenshots/INDEX.md`.

This is complete and unaffected by anything in this document. If the designer asks for a page
that doesn't functionally exist yet, that's a signal for your backlog (§8), not something to
block their design work on.

## 10. Exactly what this push contains

This push (`git log -1` on `main` right after this document lands) bundles: this document, the
action ledger and implementation-status updates, C1/C2 fixes and their evidence, the Exit
Center page, all 10 batch-1 diffs and their `live-*.mjs` scripts (whatever state they're in per
§5), and the four backend increments with their migrations and tests (§4). Excluded, as always: `.claude/`
and the three password-bearing recovery scripts. Get those from the project owner (§2.2).
