# ERP Platform + Website — Readiness

All builds green: platform `tsc`+`vite build` ✅, website `tsc`+`vite build` ✅, backend Maven `BUILD SUCCESS` ✅.

## What was implemented

### Backend (`backend/`)
- **V052 migration** (`db/canonical/V052__module_catalog_canonical_availability.sql`): seeds all 12 canonical module keys (hrms, attendance, payroll, accounting, inventory, crm, purchase, sales, projects, manufacturing, pos, reports) with `is_available=TRUE` so a **free signup auto-activates the selected modules**. Idempotent; leaves legacy rows intact; V002 untouched.
- **`/me` now returns real `activeModules`** from `platform.tenant_modules WHERE status='ACTIVE'` (was derived from RBAC permissions). Gating now reflects what the workspace actually owns.
- **`POST /v1/public/module-request`** (public): `{ subdomain, adminEmail, adminName?, modules[] }` → emails **unifiedtree@gmail.com** via the existing Brevo/SMTP MailService. Does not auto-activate (manual enablement); best-effort REQUESTED rows.

### Platform (`apps/platform` = src123.unifiedtree.com)
- **Colours unified to the Attendance-app teal palette** — fixed the design-system `tokens.css` (was emerald/mint) so every semantic class resolves to `#0F6E56` + the exact mobile palette. Tailwind config aligned. ~14 teammate HRMS files: hardcoded hex → semantic tokens, white-text-on-colour contrast fixed. **Colours only, no layout changes.**
- **Module gating:** locked modules now show **only to Admin**; Managers/Employees see only active modules. Admin clicking a locked module opens the website **Edit-Workspace** in a new tab (`VITE_WEBSITE_URL` || https://unifiedtree.com).
- **Coming-soon pages** for the 10 non-HRMS modules + routes registered (active→ComingSoon, not-active+admin→upsell, not-active+non-admin→dashboard).
- **Admin Modules page** `/modules` — all 12 with Active / Coming-soon / Locked + "Manage plan" → Edit-Workspace.
- **Web attendance:** removed all punch/check-in/out buttons (mobile-only) from `Attendance.tsx` + `EssDashboard.tsx` (hooks kept for the mobile/SDK surface). Added **admin Geofencing Zones** page (`GeofenceZones.tsx`) using `/v1/attendance/geofence/zones`. History/team/corrections/reports kept.

### Website (`apps/website` = unifiedtree.com)
- Signup now sends **all 12 selected modules** (removed the filter that dropped 8).
- New **Edit Workspace** page `/edit-workspace?ws=&email=&add=` — shows current modules as locked "Included" (add-only, never remove), select extras → `POST /v1/public/module-request` → "Request sent — we'll enable these shortly."

## ⚠ Operational checks after `git push` (important)
1. **Flyway must run V052** on the backend (Railway). If migrations are disabled, the catalog won't seed and selected modules won't activate. Confirm `SPRING_FLYWAY_ENABLED=true` and that V052 applied (check the deploy logs / `flyway_schema_history_canonical`).
2. **Existing workspaces** (e.g. src123): the `/me` change means the platform now shows only modules with an **ACTIVE** row in `tenant_modules`. New signups are fine (auto-activated). An *existing* workspace whose modules were previously only permission-derived may now show fewer tiles until its `tenant_modules` has the right ACTIVE rows. For the demo workspace, ensure at least `hrms` + `attendance` are ACTIVE in `tenant_modules`.
3. `VITE_WEBSITE_URL` on the platform defaults to `https://unifiedtree.com` — set it if your marketing domain differs.
