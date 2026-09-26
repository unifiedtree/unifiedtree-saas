# HRMS handoff (25 Sep 2026): start here

**Who this is for:** the teammate taking over deployment and the remaining build work.
Pull `main` and read this page first. It points to everything else.

## Your first task: deploy the database, backend and web app

Follow **`docs/production/DEPLOY_2026-09-26.md`** step by step. It is the one checklist, and it covers everything on `main`:
1. Back up the database.
2. Find which migrations production already has (one status query, `t`/`f` per migration).
3. Apply the missing ones of **V140 → V143_40**, in order, as a superuser. V143_2 matters most: without it every sign-in falls back to a slow scan of every workspace.
4. Deploy the backend and check it's the latest revision.
5. Check the web app (Vercel) and the production settings (face worker, mail, document storage).
6. Smoke test each role, including the settings back in their places and the left-menu fix.

`DEPLOY_2026-09-25.md` and `DEPLOY_2026-09-26_WAVE3.md` are background now. The mobile branch for assisted face punch is separate (checklist step 10).

Production never migrates itself (`SPRING_FLYWAY_ENABLED=false`). The backend won't run on an old database; Cloud Run then quietly keeps the old revision. So do the database first.

## Then: build what's still static

**`docs/Designs/BUILD_BACKLOG.md`** lists every part of the UI that's switched off ("Coming soon") or explained as not built yet.
- It opens with four decisions to get from the client (for example, whether payroll should use each company's weekly offs).
- Then P0 → P1 → P2, each item with what exists now, what to build, and when it's done.
- The full detail per screen is in **`docs/Designs/STATIC-UI-TO-BUILD.md`**; section numbers match.

## State of `main` right now

Checked on 25 Sep:
- **Web app:** type-check clean, lint 0 errors, production build passes.
- **Backend:** `mvn -pl app/hrms-app -am test`: 94 tests run, 0 failed. 32 are skipped; those are database-backed integration tests (including `EmployeeSearchIT`) and **have never been run**.
- **Live tests:** every `/hrms` route plus Settings, Users and Roles loads for each role with no failed calls (`e2e/recovery/live-browser.mjs`). Each redesigned module has its own live test, listed below.
- **Uncommitted, and meant to stay that way:** `.claude/`, `docs/design-briefs/TONIGHT.md` and the three local recovery scripts in `scripts/`.

## What was done (22–25 Sep)

The whole HRMS was redesigned to match the Claude Design screens.
- Where a design exists (dashboard, companies, attendance, payroll, master data, employee workspace, settings, reports), the page matches it.
- Every other module was rebuilt from the same parts (`apps/platform/src/design/module/ModuleKit.tsx`).
- Each page follows the API's permissions for every role: owner, admin, HR, finance, department manager and employee.
- Bugs found on the way were fixed, including in the backend.

| Area | Where it's described |
|---|---|
| Shell, dashboard, companies, attendance, payroll, master data, employee workspace | `STATIC-UI-TO-BUILD.md` §1–§7 |
| Settings pattern, Workforce Analytics + Reports Center + 6 reports | §8, §9 |
| Backend fixes batch (attendance "today absent", leave weekly offs and holidays, live headcounts, duplicate component codes, shift re-seeding, report counts) | §10 |
| Leave, My workspace, Expenses and Advances, Exit and F&F, Dashboard for every role, My team | §11.1–§11.6 |
| Hiring, Onboarding & assets, Performance, Learning, Compliance | §11.7–§11.11 |
| Muster roll, Manual entry, Geofencing, Documents and Letters, HR setup, Users & access, PLI / import / bank setup | §11.12–§11.16 |
| Performance access (ADMIN like HR; managers see only their team; team KPI progress; nightly at-risk job) | §11.17 |

### Permission changes the team should know about
- **ADMIN** now has `hrms.performance.read` and `hrms.performance.write` (V143_9): it runs appraisals and KPIs like HR.
- **Department managers**, across reviews, cycle progress, KPIs and the performance directory:
  - They see only **their team**: everyone in the departments they head, or their direct reports if they head none. That's the same as the My team page.
  - They can record progress on their team's KPIs (`hrms.kpi.progress`, V143_9).
  - They can no longer read job offers (V143_1), or other people's documents, letters or CTC (V143_4).
  - Manual attendance entry and shift definitions need `attendance.workforce.admin` (V143_5); managers approve regularizations instead.
- **Policies:** someone who may only *acknowledge* policies can now read the active ones.
- **`/employees/by-ids` and classifications** need `hrms.employee.read` (§10). The mobile app (`C:\REACT\attendance`) doesn't call `by-ids`, so it's unaffected.

## Things that will bite you

- **New permissions must also go to OWNER**, or the backend refuses to start (`OwnerPermissionInvariantCheck`). V143_9 already does this for `hrms.kpi.progress`.
- **Employee baseline permissions are cached for 5 minutes** (`EmployeeBaselinePermissions`). A role change for the EMPLOYEE role shows up on sign-in within 5 minutes, not instantly.
- **The web app talks to the production API by default** unless `.env.development` or your local env points elsewhere. Don't test against production data by accident.
- **Don't process, lock or pay a real payroll run** to try something. Overtime approval only records the decision; it's never paid (a business rule).
- **Document storage:** without R2 configured, documents can't be uploaded or opened. The UI says so rather than showing dead links.

## Running things locally

- Backend: JDK 21, `cd backend && mvn -pl app/hrms-app -am package -DskipTests`, then run the jar with the `canonical` profile (see `HRMS_HANDOFF_2026-09-24.md` for the full local setup and the demo users).
- Web: `cd apps/platform && npx vite`. Type-check with `npx tsc --noEmit -p .`, lint with `npx eslint src --ext ts,tsx --quiet`, build with `npx vite build`.
- **Live tests** (`apps/platform/e2e/recovery/*.mjs`) run against a **local** backend and a local Postgres (`unifiedtree_recovery` on port 55432) seeded with the demo users (`owner@`, `mgr@`, `fin@`, `reader@unifiedtree.demo`). Each one prints PASS/FAIL per check and removes what it creates:
  - Modules: `live-design-dashboard`, `-companies`, `-attendance`, `-payroll`, `-master`, `-workspace`, `-hrconfig`, `-settings`, `-reports`, `-leave`, `-expenses`, `-team`, `-onboarding`, `-performance`, `-learning`, `-attendance-admin`, `-documents`, `-hrsetup`, `-access`, `-last`
  - Rules: `live-performance-scope`, `live-backend-fixes`
  - Sweeps: `live-browser` (every route), `live-dead-entrypoints`

## Local data you may notice

Old QA rows from earlier test runs are still in the **local** recovery database: "Local Onboarding QA" hires, paid Jan–Mar 2027 test payroll runs, old review cycles, "Local QA leave" types and letter templates. They're referenced by payroll and letters, so they were left alone. None of this is in production.
