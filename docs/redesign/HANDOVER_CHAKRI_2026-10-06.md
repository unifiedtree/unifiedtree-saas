# Handover — Chakri's lane to Friday 9 Oct 2026

For: chakridol143 and his Claude. Lead for HRMS + app: Saiteja (with his Claude).
Deadline: **Friday 9 Oct 2026** for three deliverables — HRMS, the mobile app, WhatsApp.

Read first:
1. `docs/UNIFIEDTREE_MASTER_CONTEXT.md` — the product spec (44 sections). Newer decisions below override it.
2. The shared tracker (386 checked requirements, status/owner/note per row; filter Lane = Teammate):
   https://claude.ai/artifact/Q37nw9o3qZBMeaeonEhgAR — update your rows there as you go (In progress / Done / Blocked + note).
3. `docs/redesign/TEAMMATE_SETUP.md` — local setup (backend, local DB, web). Its rule 3 still applies: never start the
   web app without a local target, or it talks to the PRODUCTION API.

---

## 1. Your lane (what you own this week)

| Area | What to deliver by Fri 9 Oct | Tracker ids |
|---|---|---|
| **WhatsApp** | Scope written down; WhatsApp Business number + Meta verification started **today**; sending service; webhook (delivery/read, replies, STOP/opt-out, signature check); message templates submitted to Meta; WhatsApp as a delivery channel in the notification system with employee consent; first use cases: **payslip published**, **attendance alerts (missed punch, late)**, **leave approved/rejected**. Broadcasts and two-way chat are next version. | H-01 … H-17 |
| **Admin panel** (for us, platform staff) | v1: list and inspect businesses (owner, companies, employees, modules, subscription), suspend/unlock a business, subscriptions and payments across businesses, failed payments. Sign-up approval queue stays empty (sign-up is self-service). | H-19 … H-27 |
| **Website → platform** | One business per account (no "Create new workspace"); sign-up form says **Business name** plus a **Company name** field for the first company; HRMS pricing page (per user, per company, monthly/yearly, fix the FAQ that says "no credit card"); refund policy page; remove WhatsApp promises from the website until it is live. | A-01, A-04, B-19, G-73, G-82, G-83, H-17 |
| **Billing** | Trial, reminders, grace and module pause per the rules below; subscription and seats per company; seat limit becomes a soft limit. Automatic month-end extra-user charge and invoice per company are **next version** unless you finish early. | B-01, B-08, B-13, B-14, B-15 |
| **Release safety** | Production schema + migration-history comparison; Flyway ledger (you already own CI/Flyway). | G-125, G-128, G-129 |

### Rules the client/owner confirmed (6 Oct) — build exactly these
- Everything is self-service; no manual approval checkpoints.
- **Free trial: 7 days.** Billing starts on day 8; the monthly cycle is date-to-date (e.g. 6 Oct – 6 Nov).
- **Reminders** start 3 days before the due date and repeat every day until paid.
- **Grace: 7 days** after the due date. Then pause **only the unpaid modules** — do NOT block sign-in, so the owner/admin can still pay.
- **One business per person**: a user belongs to one business only — cannot own one and be invited into another.
- Sign-up: "Business name" + a company-name field; more companies are created later inside the workspace.
- Accounts that already have several workspaces are test data — no migration needed for them.
- The app's Alerts "Messaging" tab is in-app team messaging only (not WhatsApp).
- Billing is company-wise; HRMS is one package (HR + Attendance + Leave + Payroll); autopay only; monthly and yearly.

### Day plan
- **Tue 6** — WhatsApp scope + Meta verification + number; sign-up one-business + wording; pricing/FAQ/refund pages; remove WhatsApp promises.
- **Wed 7** — WhatsApp sending service + webhook + templates submitted; admin panel v1 (list/inspect, suspend/unlock); billing per company + soft seat limit.
- **Thu 8** — WhatsApp channel + consent + payslip and attendance/leave alerts to the test team; admin panel subscriptions/payments; reminders/grace/module pause; failed-payment alerts.
- **Fri 9** — billing isolation + payment-failure tests; production schema/migration comparison; WhatsApp live (once Meta approves); billing live.

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
4. **WhatsApp channel** — add `WHATSAPP` to the notification delivery channels (the DB enums already allow it; the Java `DeliveryChannel` and the dispatcher don't).
   Expose it in the notification catalog per event, with the employee's consent. Saiteja's lane adds the WhatsApp toggle to the web and app notification
   settings once you tell us how the catalog lists it. Mobile numbers must be valid E.164.
5. **Companies** — Saiteja's lane is building multi-company inside HRMS this week: a global company selector and roles per company
   (one person = one login; access is granted per company). Billing per company keys on `org.companies.id`. Don't change `org.companies`,
   `rbac.user_roles` or the auth/session payload without telling us — we are changing them.
6. **Platform security (live since 6 Oct)** — `platform.*` permissions now exist only on PLATFORM_SUPER_ADMIN, and `/v1/platform/tenant-requests/**`
   requires a platform-staff token (`@platformAdmin.check(authentication)` in `PlatformAdminAccess`, issued only by `POST /v1/platform/auth/login`).
   Build the admin panel on that login. Nobody holds PLATFORM_SUPER_ADMIN in production yet — the account comes from `PlatformAdminBootstrap`
   (environment variables). Never give business roles any `platform.*` permission (V143_92 blocks it).

## 3. Files

- **Yours:** the WhatsApp service/worker, `backend/platform/platform-saas/**` (sign-up, billing, Razorpay, admin endpoints),
  the website (`apps/website` / marketing pages), billing/plan pages, the new admin panel, notification dispatcher + channel work,
  CI and Flyway.
- **Ask first (shared):** `backend/platform/**` outside platform-saas (auth, RBAC, notifications core), `application*.yml`, `Dockerfile`,
  `apps/platform/src/core/**`, `apps/platform/src/shared/**`, `packages/**`.
- **Saiteja's (don't edit; tell us what you need):** `apps/platform/src/modules/hrms/**`, `backend/modules/hrms-*/**`,
  `backend/app/hrms-api/src/main/java/com/hrms/api/**` except `saas/` and `platform/`, and the mobile app repo
  (`SRC-ORGanisation/attendance`).

## 4. Git and GitHub

- Repo: `https://github.com/unifiedtree/unifiedtree-saas` — `main` is what production runs (web auto-deploys to Vercel from `main`).
- Work on branches `chakri/<topic>` cut from the latest `origin/main`. Rebase on `origin/main` before merging.
- Open a PR into `main`; merge when CI is green. Saiteja's lane also pushes to `main` several times a day — always rebase first, never force-push `main`.
- Small, separate PRs per area (WhatsApp, admin panel, sign-up, billing) so a problem in one doesn't hold the others.
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
