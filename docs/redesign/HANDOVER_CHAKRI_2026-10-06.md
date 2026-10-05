# Handover — Chakri's lane to Friday 9 Oct 2026

For: chakridol143 and his Claude. Lead for HRMS + app: Saiteja (with his Claude).
Deadline: **Friday 9 Oct 2026** — HRMS and the mobile app. WhatsApp automation and the admin panel are paused (owner, 6 Oct).

Read first:
1. `docs/UNIFIEDTREE_MASTER_CONTEXT.md` — the product spec (44 sections). Newer decisions below override it.
2. The shared tracker (386 checked requirements, status/owner/note per row; filter Lane = Teammate):
   https://claude.ai/artifact/Q37nw9o3qZBMeaeonEhgAR — update your rows there as you go (In progress / Done / Blocked + note).
3. `docs/redesign/TEAMMATE_SETUP.md` — local setup (backend, local DB, web). Its rule 3 still applies: never start the
   web app without a local target, or it talks to the PRODUCTION API.

---

## 1. Your lane (what you own this week)

**Paused by the owner on 6 Oct — do NOT work on these now:** WhatsApp automation and the platform admin panel (for UnifiedTree staff).

| # | Area | What to deliver by Fri 9 Oct | Tracker ids |
|---|---|---|---|
| 1 | **Billing & subscriptions (company-wise)** | 7-day trial; billing from day 8, date-to-date cycle; reminders from 3 days before due, daily until paid; 7-day grace, then pause only the unpaid modules (sign-in stays open); seat limit becomes a soft limit with "extra users billed at cycle end"; subscription and seats per company; HRMS pricing page (per user, per company, monthly/yearly, fix the "no credit card" FAQ); refund policy page. Month-end automatic extra-user charge and invoice per company: next version unless you finish early. | B-01, B-08, B-13, B-14, B-15, B-19, G-82 |
| 2 | **Sign-up & login** | One business per account (no "Create new workspace"); sign-up says **Business name** + a **Company name** field for the first company; Google sign-in on the business login page (today only on the website login); mobile-number login on the web (confirm with the owner: SMS one-time code or mobile + password); old links (invites, password reset, bookmarks) keep working; Keka-style login page once the owner sends the screenshot. | A-01, A-04, A-20, A-21, A-25, A-27, G-73, G-81, G-83 |
| 3 | **Settings model** | Business settings (details, branding, users, roles, billing) on the modules launcher; HRMS gets **one** Settings entry that gathers today's scattered places (HR setup, Payroll settings, Rules & policies, Payroll configuration, document types). Coordinate the HRMS nav change with Saiteja (his agents are changing the HRMS header for the company selector this week). | A-22, A-23, G-75, G-76 |
| 4 | **Ownership transfer** | New owner gets access, ownership moves, old owner keeps a transition period of up to 15 days (can guide, cannot act as owner), then loses full access. Write a short design first (who can start it, what the old owner can do, billing handover, audit), then build backend + web. | A-29 |
| 5 | **Release safety & testing** | Bring back the full 55-script live regression (last run 2 Oct, 13 failures) and fix the test scripts that are out of date; build the two-company test fixture (Company A and B, both EMP-0001) with Saiteja; light/dark/phone pass of the final build; production schema + migration-history + role-permission comparison; Flyway ledger. | G-84, G-114, G-116, G-125, G-128, G-129, G-145 |

### Rules the client/owner confirmed (6 Oct) — build exactly these
- Everything is self-service; no manual approval checkpoints.
- **Free trial: 7 days.** Billing starts on day 8; the monthly cycle is date-to-date (e.g. 6 Oct – 6 Nov).
- **Reminders** start 3 days before the due date and repeat every day until paid.
- **Grace: 7 days** after the due date. Then pause **only the unpaid modules** — do NOT block sign-in, so the owner/admin can still pay.
- **One business per person**: a user belongs to one business only — cannot own one and be invited into another.
- Sign-up: "Business name" + a company-name field; more companies are created later inside the workspace.
- Accounts that already have several workspaces are test data — no migration needed for them.
- Billing is company-wise; HRMS is one package (HR + Attendance + Leave + Payroll); autopay only; monthly and yearly.

### Day plan
- **Tue 6** — sign-up one-business + wording + company field; pricing/FAQ/refund pages; start the regression revival (run it, list failures); ownership-transfer design note.
- **Wed 7** — billing per company + soft seat limit; trial/reminder/grace rules; Google sign-in on the business login; settings on the launcher.
- **Thu 8** — module pause after grace + failed-payment alerts; one HRMS Settings entry; ownership transfer built; two-company test suite with Saiteja.
- **Fri 9** — full regression + light/dark/phone pass; production schema/permission comparison; billing and sign-up changes live.

---

## 2. Contracts with the HRMS + app lane (agree before you change these)

1. **Soft seat limit** — your backend stops the hard 402 on adding employees over the bought seats and returns the usage.
   Expose it in the existing seats/billing summary as fields like `{ seatsBought, seatsUsed, overBy, extraBilledAtCycleEnd: true }`.
   Saiteja's lane changes the HRMS dashboard text ("Adding employees is blocked" → "N extra users will be billed at the end of the cycle")
   and the Add-employee button. Tell us the exact field names.
2. **Module pause after grace** — when a module is paused, its API calls answer **402 with a stable code** (e.g. `MODULE_PAUSED`, plus the module key and
   due amount if available). Sign-in, `/me`, billing and payment endpoints must keep working. Saiteja's lane builds the "payment needed" screen on web
   and in the app from that code. Tell us the code and body.
3. **Reminder/alert events** — send them through the existing notification system (in-app + push + email) so web and app show them without new screens.
4. **Companies** — Saiteja's lane is building multi-company inside HRMS this week: a global company selector and roles per company
   (one person = one login; access is granted per company). Billing per company keys on `org.companies.id`. Don't change `org.companies`,
   `rbac.user_roles` or the auth/session payload without telling us — we are changing them.
5. **Platform security (live since 6 Oct)** — `platform.*` permissions now exist only on PLATFORM_SUPER_ADMIN, and `/v1/platform/tenant-requests/**`
   requires a platform-staff token (`@platformAdmin.check(authentication)` in `PlatformAdminAccess`, issued only by `POST /v1/platform/auth/login`).
   (The admin panel is paused.) Nobody holds PLATFORM_SUPER_ADMIN in production yet — the account comes from `PlatformAdminBootstrap`
   (environment variables). Never give business roles any `platform.*` permission (V143_92 blocks it).

## 3. Files

- **Yours:** `backend/platform/platform-saas/**` (sign-up, billing, Razorpay), the website (`apps/website`), billing/plan pages,
  the login pages, business settings on the launcher, ownership transfer, the live regression scripts (`apps/platform/e2e/**` you fix), CI and Flyway.
- **Ask first (shared):** `backend/platform/**` outside platform-saas (auth, RBAC, notifications core), `application*.yml`, `Dockerfile`,
  `apps/platform/src/core/**`, `apps/platform/src/shared/**`, `packages/**`.
- **Saiteja's (don't edit; tell us what you need):** `apps/platform/src/modules/hrms/**`, `backend/modules/hrms-*/**`,
  `backend/app/hrms-api/src/main/java/com/hrms/api/**` except `saas/` and `platform/`, and the mobile app repo
  (`SRC-ORGanisation/attendance`).

## 4. Git and GitHub

- Repo: `https://github.com/unifiedtree/unifiedtree-saas` — `main` is what production runs (web auto-deploys to Vercel from `main`).
- Work on branches `chakri/<topic>` cut from the latest `origin/main`. Rebase on `origin/main` before merging.
- Open a PR into `main`; merge when CI is green. Saiteja's lane also pushes to `main` several times a day — always rebase first, never force-push `main`.
- Small, separate PRs per area (billing, sign-up & login, settings, ownership transfer, tests) so a problem in one doesn't hold the others.
- Commit messages in plain English. No secrets, tokens or credentials in commits, docs or PR text — ever.

## 5. Migrations and production

- Your migration numbers: **V144_1, V144_2, …** (ours are V143_x; the last used is V143_92). Idempotent SQL only (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Never add or change a column that a JPA `@Entity` maps unless the migration is applied in production first (`ddl-auto: validate` stops the app from starting).
  Prefer `JdbcTemplate` for new tables/columns.
- Every new permission must be granted to OWNER and SUPER_ADMIN (OwnerPermissionInvariantCheck stops start-up otherwise) and shown on the Roles screen.
- Production Flyway is OFF. Apply a migration by hand: take a Cloud SQL backup first (wait for SUCCESSFUL), wrap the SQL in `BEGIN; … COMMIT;`, import as `postgres`,
  then verify with a read-only query. Write in the group what you applied and the backup id.
- Backend deploys are by hand from `main` (`gcloud run deploy unifiedtree-saas --source backend --region asia-south1 --project unifiedtree-445cd`).
  Before deploying: post in the group so two deploys never overlap; take a backup if a migration goes with it. After deploying: read the new revision's
  start-up logs (`Started HrmsApplication`, no ERROR) — a failed revision keeps the old one serving; note the rollback revision.
- Never test against production data. Read-only queries only; nclever is the only real customer — read aggregates only, never change its data.

## 6. Every evening
- Release to the test team, update your tracker rows, and post in the group: what shipped, what is blocked, what you need from the client.
