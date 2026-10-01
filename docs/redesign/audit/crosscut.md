# Phase 0 audit: cross-cutting — every pop-up, the test inventory, backend conventions

**Area:** every modal, drawer, side panel, confirm dialog, native `confirm()`/`prompt()`, popover, menu and toast in `apps/platform/src` for the HRMS module and the admin pages the design's `PgAdmin` covers (settings, users, roles, audit log); every test in the repo; the backend conventions builders must follow; copy style; the icon sets.

**Repo:** `C:\REACT\unifiedtree-saas` at `e32a4dc6` (main). Read-only: nothing in the repo was changed.

**How this was checked:** read the code, the Flyway migrations, the e2e scripts and the design handoff. Counts come from read-only scripts over the source (kept in my scratchpad, not in the repo) and are exact for the patterns named. The recovery API (`127.0.0.1:8080`) and database (`127.0.0.1:55432`, `unifiedtree_recovery`) were up; I used them only to read the Flyway history (latest applied version **143.40**) and the demo logins (owner = OWNER, admin = SUPER_ADMIN, hrm = HR_MANAGER, fin = FINANCE_LEAD, mgr = DEPT_MANAGER, reader = EMPLOYEE). The in-progress overlay kit in the worktree `rd-f2b-kit-overlays` (untracked files) was read only to cross-check contracts.

**Scope note:** the per-screen audits (`dashboard.md`, `workforce.md`, `attendance.md`, `leave-payrun.md`, `pay.md`, `talent.md`, `grow-reports.md`, `setup-admin.md`, `shell.md`, `foundation.md`) list what each screen shows. This report lists **every pop-up once**: where it is, what it is for, who can open it, what it saves through (API and backend guard), which tests depend on it, and how Phase 7 should convert it.

---

## 1. Summary

### 1.1 Pop-ups today

| Family | Count | Engine | Look today |
|---|---|---|---|
| `HrDrawer` side panels | **65 uses in 44 files** (15 of them in 13 generated `design/dc/*.view.tsx`) | `shared/components/hr.tsx:640` | white, square, `border-l`, title 20px/**700**, slate-900/40 + blur backdrop, z 1000 |
| ui-kit `Modal` dialogs | **23 uses in 21 files** (10 in generated views) | `packages/ui-kit/src/components/Overlay.tsx` (Radix) | radius 16, black/40 + blur, z 400/500 |
| ui-kit `Drawer` | **4 uses in 2 files** (Roles, Users) | same file | 448px right panel, black/30 backdrop, z 400/500 |
| Hand-rolled drawers and modals | **11** (10 live, 1 dead) in 6 files | inline JSX | rounded "glass" cards (`ut-card ut-glass`), black/40–70 + blur, z 100–210 |
| Master design overlays | **12 form drawers + 1 profile drawer + 6 modals**, plus popovers, dropdowns, menus, tips, toasts | `design/master/MasterDesign.tsx` + `master.css` | own CSS: drawer 600px, modal radius 20, titles weight **800**, z 200–400 |
| Confirms through `useConfirmDialog()` | **14 calls in 11 files** | `shared/components/ConfirmDialog.tsx` (provider in `main.tsx`) | `ut-card` 384px, old emerald `#059669`, red `#DC2626`, z 9999 |
| Native `window.confirm` | **23 calls in 16 files** (19 in HRMS modules, 4 in `pages/`) | browser | unstyled |
| Native `window.prompt` | **2** (document rejection reason, bank UTR) | browser | unstyled |
| Popovers, menus, listboxes, tooltip | shared calendar (67 date fields in 41 files), DashCalendar, TimePicker, `HrSelect` (25 files), 5 hand-rolled menus, company picker, one global tooltip (169 `data-tip`), Master popovers | various | various radii (10–16), Inter font, light only |
| Shell pop-ups (Phase 1, owned by `shell.md`) | profile menu, notifications popover, Advanced search, phone search sheet, phone nav drawer | `PlatformShell.tsx`, `ShellChrome.tsx`, `TopBarSearch.tsx` | |
| Toast systems | **5** | sonner (top-right), `useDesignToast`, `useSettingsToast`, `useReportToast`, Master `Toasts` (bottom-right) | |

**161 pop-up instances** (65 + 23 + 4 + 11 + 19 + 14 + 23 + 2), plus the popovers and toasts. None of them is dark-mode safe; most use weights above 600; none uses the design's backdrop.

### 1.2 The safest path for Phase 7 (details in §6)

1. **Re-skin the three engines, not the call sites.** Rebuild `HrDrawer`'s inside on the kit `SidePanel`, restyle ui-kit `Overlay.tsx` (`Modal`, `Drawer`), and rebuild `ConfirmDialogProvider` on the kit `Dialog`. That gives **106 instances** the new look with **no call-site edits**, including the 25 inside generated views (which must not be edited by hand).
2. Convert the **23 `window.confirm`** calls to `useConfirmDialog()` (same promise API) and the **2 `window.prompt`** calls to a small Dialog with a required text field. One of them (the legacy employee form's navigation guard) is synchronous and needs special handling (§6, question 1).
3. Restyle the **Master** overlays through `master.css` (`.utm .scrim/.drawer/.modal/.pop/.toast`). This keeps the DOM and the class names four live tests locate.
4. Replace the **10 live hand-rolled** overlays one by one with kit components.
5. Keep the contracts tests and users depend on (§5): `role="dialog"` with the title as its name, "Close panel" on panels, focus trap and focus return, Escape layering with the calendar, busy guards, stacking order, portals.

### 1.3 Tests

- **vitest:** 12 files, 93 tests, all real unit tests of logic (no DOM; the repo has no jsdom or Testing Library).
- **Playwright spec suites:** `e2e/tests` 47 files / 216 tests and `e2e/live` 11 files / 39 tests. Neither is in the wave gate.
- **Live scripts `e2e/recovery`:** 117 files. **55 are the final gate** (`_tools/final-run.sh`): 52 drive the browser, 3 are API-only. 38 more are API/DB-only (a restyle cannot break them). 24 more drive the browser outside the gate (4 of them are screenshot tools).
- **Backend:** 127 unit test classes / 753 test methods (`mvn test`), plus 27 Docker integration classes / 144 tests (`*IT`, `mvn verify`; the Docker daemon is not running on this machine).
- The last recorded gate runs (26 Sep, `_results/final-3`) had failures in `live-design-settings` and `live-dead-entrypoints`. Main has moved since. **A fresh baseline of the 55 on `e32a4dc6` is needed before any redesign merge** (§7.6).

### 1.4 Backend (for builders, §9)

Controllers in `backend/app/hrms-api/src/main/java/com/hrms/api/<area>/`; `@PreAuthorize("hasAuthority('code')")` (token claim) or `@PreAuthorize("@perm.check('code')")` (live check, 60 s cache). Migrations in `backend/app/hrms-app/src/main/resources/db/canonical/`, named `V143_<n>__snake_case.sql`; the latest on main and in the recovery DB is **V143_40**; 143.29 and 143.35–143.39 were never used. Production applies migrations **by hand as a superuser**, so every migration is idempotent and every new feature must degrade gracefully until it is applied. New tables and columns are read and written with `JdbcTemplate` only; tables get RLS (`ENABLE` + `FORCE` + a `tenant_id = current_tenant_id()` policy) and `ut_app` grants; every new permission is inserted with a plain-English name and description and granted to OWNER and SUPER_ADMIN (the app refuses to start otherwise). Audit with `AuditService.record(module, action, entityType, entityId, summary)`.

---

## 2. What the design specifies for pop-ups (exact values)

The prototype has only three real pop-ups: the Companies side panel (`PgCompanies.dc.html` lines 71–98), the More panel (`UtMore.dc.html` + `HrmsPlatform.dc.html` line 73) and the ⌘K search dialog (`UtSearch.dc.html` lines 11–12). Every other prototype action ends in a toast. **There is no confirm dialog and no form dialog in the prototype**, so the Dialog look must be composed from the README rule (12px radius, popover shadow, gradient-blur backdrop) and the kit's type scale and buttons.

### 2.1 Side panel (PgCompanies)

| Part | Value |
|---|---|
| Backdrop | `position:fixed; inset:0; z-index:70; background: linear-gradient(270deg, rgba(14,27,22,.38), rgba(14,27,22,.2)); backdrop-filter: blur(4px) saturate(.85)`; a click closes |
| Panel | `<aside role="dialog" aria-label="{title}" data-pop="right">`, fixed top/right/bottom, z 71, `width: min(680px, 100vw)`, column flex, `background: var(--u-sf,#fff)`, `border-left: 1px solid var(--u-ln,#E3E9E6)`, `box-shadow: -30px 0 70px -30px rgba(14,27,22,.45)`, **no radius** |
| Header | padding `22px 24px 16px`; bottom hairline as `box-shadow: inset 0 -1px 0 var(--u-ln2,#EDF1EF)`; title h2 20px/500; sub-line 13.5px ink3, 4px above; close button 38×38 round, `background: var(--u-hv,#F0F4F2)`, ink2 X 18px, hover `#E3EAE7`, `aria-label="Close"` |
| Step list (optional) | `<ol>` 196px wide, padding `20px 12px 20px 20px`, right hairline; each step is a button (8px padding, radius 10, 13.5px/500, hover `--u-hv`) with a 26px circle: done = brand fill + white tick; current = 2px brand ring + brand number 12px/600; todo = 1.5px line ring + ink3 number 12px/500 |
| Body | `overflow-y:auto; padding:20px 24px; gap:14px`; section header = 40px tile (radius 12, `#E8F3EE`, brand icon 19px) + title 15.5px/500 + sub 12.5px ink3; fields in a 2-column grid (gap 14): label 13px/500 above a 44px input, radius 12, 1px line, 14px/400 |
| Toggle card | "Mark as headquarters": 14px padding, 1px line, radius 14, `--u-sf2` background, 20px box radius 6 |
| Footer | `justify-content: space-between; padding: 16px 24px; box-shadow: inset 0 1px 0 var(--u-ln2)`. Back/Cancel: 44px high, `0 18px`, 1px line, radius 12, white, 14px/500, hover brand border. Next/final: 44px, `0 20px`, radius 12, brand fill, white 14px/500, arrow 16px, shadow `0 12px 24px -14px rgba(15,110,86,.9)`, hover `#0B5A46`. Disabled Next = a `<span>` with `background:#9CC7B8; cursor:not-allowed; title="{what is missing}"` |
| Motion | `hrms-fx.js pop()`: 260 ms, `cubic-bezier(.2,.8,.2,1)`. `left` → `translateX(-18px)`, `up` → `translateY(12px) scale(.98)`, anything else (including `right`) → `translateY(-6px) scale(.98)` |

### 2.2 Dialog

README: "menus/popovers/dialogs use 12px radius", popover shadow `0 24px 60px -20px rgba(14,27,22,.35)`, backdrop = the side-panel gradient + blur. The ⌘K container (`UtSearch`): backdrop `var(--u-ov, rgba(14,27,22,.36))` + `blur(3px)`; panel `max-width:880px; max-height:calc(100vh - 110px); border:1px solid var(--u-ln); border-radius:12px; box-shadow: var(--u-shp, 0 40px 100px -30px rgba(14,27,22,.55)), 0 0 0 6px rgba(15,110,86,.06)`.

### 2.3 More panel (left side panel)

320px, square, `box-shadow: 28px 0 60px -32px rgba(14,27,22,.5)`, backdrop `linear-gradient(90deg, rgba(14,27,22,.34), rgba(14,27,22,.18))` + `blur(3px) saturate(.9)`, `data-pop="left"`.

### 2.4 Toast (`HrmsPlatform.dc.html` line 77)

`role="status"`, `data-pop="up"`, bottom 24px, centred, width 360, padding `12px 16px`, radius 12, background `#0E1B16`, white 13.5px/500, check-circle icon 16px stroke `#8FD9BE`, shadow `0 18px 40px -14px rgba(14,27,22,.55)`. README: 2.6 s.

### 2.5 Keyboard and access

Esc closes popovers and panels; icon-only buttons have labels; focus ring `0 0 0 3px #E8F3EE` + brand border. The prototype's panel has **no `aria-modal` and no focus trap**; today's `HrDrawer` and Radix modals have both. Keep ours.

---

## 3. Today's overlay engines

| Engine | File | Behaviour | z | Look | Notes |
|---|---|---|---|---|---|
| `HrDrawer` | `shared/components/hr.tsx:640–714` | portal to body; `role="dialog" aria-modal aria-labelledby` → the title (an `h3`); focus moves into the panel and returns on close; Tab is trapped; Escape (window keydown, bubble phase); backdrop click closes; close button `aria-label="Close panel"`; framer-motion spring slide; `width` prop takes a Tailwind `max-w-*` (default `max-w-lg`) | 1000 | `bg-white`, `border-gray-200/60`, title `text-xl font-bold`, footer `bg-gray-50/80 backdrop-blur-md` | 18 call sites block closing while saving: `onClose={() => { if (!x.isPending) onClose() }}` |
| ui-kit `Modal` | `packages/ui-kit/src/components/Overlay.tsx` | Radix Dialog: focus trap, Escape, outside click (unless `preventOutsideClose`), title and description always rendered (sr-only when absent), sr-only "Close", `pointer-events:none` on `<body>` while open; **centring lives in framer-motion `x/y`**, not Tailwind (comment: QA 2026-08-30 P0-4, the invite modal hung off-screen) | 400/500 (`--z-modal-backdrop`, `--z-modal`) | `rounded-2xl p-6`, `bg-[var(--bg-surface)]`, title 16px/600 | `packages/ui-kit/src/components/Modal.tsx` and `Drawer.tsx` are an older dark-slate version that is **not exported**; don't restyle those |
| ui-kit `Drawer` | same file | Radix; right side, `max-w-md` | 400/500 | black/30 backdrop | |
| `ConfirmDialogProvider` / `useConfirmDialog()` | `shared/components/ConfirmDialog.tsx`; mounted in `main.tsx` | `confirm({ title, body, confirmLabel, cancelLabel, tone })` → `Promise<boolean>`; `role="dialog" aria-modal aria-labelledby`; confirm button autofocused (Enter confirms); Escape and backdrop cancel; no Tab trap; **one at a time: a second request while one is open replaces it and the first promise never settles**; falls back to `window.confirm` when the provider is missing | 9999 | `ut-card` max 384px, danger icon `#FEE2E2/#B91C1C`, danger `#DC2626`, default **`#059669`** | |
| `SettingsLeaveModal` | `design/settings/SettingsKit.tsx:353` | ui-kit Modal "Discard unsaved changes?" | 500 | | exported but **not used by any page** (PaySettings has its own copy) |
| Master `Drawer`, `RecordForm`, `Modal`, `Popover`, `Dropdown`, `Menu`, `Tip`, `Toasts` | `design/master/MasterDesign.tsx:124–185`, `master.css:153–240` | portal into `#utm-portal`; drawer `role="dialog" aria-label={title}`, **no `aria-modal`, no focus trap**; Escape closes the drawer only when no popover or modal is open; modal 480px with Cancel + CTA (`danger`/`pri`, `okDisabled`); popover flips above when short of room and closes on outside mousedown, Escape, scroll, resize; toasts bottom-right | scrim/drawer 200/201, modal 210/211, pop 300, toasts 400 | drawer 600px, `.dr-h h3` 19px/800, modal radius 20, `.md-b h3` 18px/800 | generated by `scripts/master-build.mjs` + `master-patches.mjs` from `docs/Designs/UnifiedTree Master (offline).html` |
| Shared calendar popover | `shared/components/calendar/CalendarField.tsx:520–560`, `calendar.css:109–130, 405–420` | portal to body; `role="dialog"`, `aria-label` "Choose date" / "Choose month" / "Choose date range"; **focus stays on the trigger** (`aria-activedescendant`) so `HrDrawer`'s and Radix's focus traps keep working; **Escape is caught at window capture and stopped**, so only the calendar closes; `pointer-events:auto` (Radix sets none on body); flips above, stays in view; phones (≤ 480px) get a bottom sheet over `.utc-backdrop` | popover 10001, sheet backdrop 10000 | radius 16, white, Inter, `#059669` accents | 67 date fields in 41 files; client decision: every date field uses it |
| `TimePicker` | `design/dc/TimePicker.view.tsx:40` (generated) | `UTPortal` to body, fixed; `role="dialog" aria-label={heading}`; listboxes Hour / Minute / AM-PM | 1200 | | used by AttRegularization, ShiftSchedules |
| `DashCalendar` | `design/dc/DashCalendar.view.tsx:12` (generated) | not portalled, placed under the dashboard's date chip; `role="dialog" aria-modal aria-label="Choose dashboard date"` | in page | | |
| `HrSelect` | `hr.tsx:505` | listbox in place (not portalled), full keyboard | `z-dropdown` (100) | | 25 files |
| `DesignTooltip` | `design/shell/ShellChrome.tsx:247–285` | one tooltip for every `data-tip` (169 uses), fixed, `pointer-events:none` | 9999 | dark | the design's "Next disabled with a tooltip" can use it |
| Toasts | sonner `<Toaster richColors position="top-right" />` (`main.tsx`) used by `useToast()` (29 files) and `toast.*` (20 files); `useDesignToast` (`ModuleKit.tsx:211`, 25 files; bottom centre, 3.2 s / errors 7 s, Dismiss button); `useSettingsToast` (7 files; 3.2 s / 8 s); `useReportToast` (`ReportKit.tsx:62`; z 90; 3.2 s / 6 s); Master `Toasts` (bottom-right, 3.6 s / 6.5 s, class `.toast`) | | 1400 (ModuleKit, Settings), 90 (Report), 400 (Master) | | |

**Stacking today (low → high):** HrSelect / notifications popover 100 · Master 200–400 · ui-kit Modal/Drawer 400/500 · HrDrawer 1000 · TimePicker 1200 · kit toasts 1400 · ConfirmDialog 9999 · tooltip 9999 · calendar sheet 10000 · calendar popover 10001. The in-progress kit uses SidePanel 1000, Dialog 1100, Popover 1200, which fits this order. The design-system Tailwind preset defines a smaller scale (`dropdown 100 … modal 500, toast 600, tooltip 700`) that most overlays already exceed; the theme package should publish one scale.

---

## 4. Inventory of every pop-up

Columns: **where** (file:line; "gen." = generated view, do not hand-edit) · **title / purpose** · **page** · **who can open it** (frontend gate) · **what it calls** [backend guard] · **tests** that open it (by dialog name or opener text; "—" = none found).

### 4.1 `HrDrawer` side panels (65)

| # | Where | Title / purpose | Page | Who can open it | What it calls [backend guard] | Tests |
|---|---|---|---|---|---|---|
| H1 | `design/dc/AttDailyLogs.view.tsx:114` (gen.) | "{person}" day detail: status, late note, facts; footer Open full profile · Fix this day · Change status · View history | `/hrms/attendance` (Daily tracking) | page `attendance.team.read`; Change status `attendance.status.override` | nothing itself; "Fix this day" opens Manual entry for HR (`/hrms/attendance/manual-entry?employeeId=&date=`), "Change status" opens H19 | live-design-attendance ("Fix this day") |
| H2 | `design/dc/AttRegularization.view.tsx:142` (gen.) | "Ask for a fix" (one day, optional proof) | `/hrms/attendance` (My attendance) | `attendance.checkin.self`; tab hidden for OWNER/ADMIN/SUPER_ADMIN/COMPANY_ADMIN | `POST /v1/attendance/corrections`, `POST /v1/attendance/corrections/attachments` [`attendance.checkin.self`] | — |
| H3 | `design/dc/BranchDrawer.view.tsx:12` (gen.) | "Create branch" / "Edit branch" / "Branch details" (read-only), with geofence map | `/hrms/companies` | `org.company.write`; geofence `org.geofence.write` | `POST /v1/hrms/branches`, `PUT /v1/hrms/branches/{id}` [`org.company.write`]; `PUT /v1/hrms/branches/{id}/geofence` [`org.geofence.write`] | live-design-companies. **Phase 5** replaces it with the stepper panel |
| H4 | `design/dc/CompanyDrawer.view.tsx:10` (gen.) | "Add company" / "Edit company" | `/hrms/companies` | `org.company.write` | `POST /v1/hrms/companies`, `PUT /v1/hrms/companies/{id}` [`org.company.write`] | live-design-companies, live-w3-r1 ("Add company"). Phase 5 |
| H5 | `design/dc/EmployeeWorkspace.view.tsx:478` (gen.) | "Change employee shift" | `/hrms/employees/:id` | `attendance.workforce.admin` | `POST /v1/shifts/employee/{employeeId}` [`attendance.workforce.admin`] | live-admin-actions, live-design-workspace, live-w3-r1 |
| H6 | `design/dc/EmployeeWorkspace.view.tsx:516` (gen.) | "Edit employee" (2 steps; a link opens the legacy full form X1) | `/hrms/employees/:id` | `hrms.employee.write` | `PUT /v1/hrms/employees/{id}` [`hrms.employee.write`] | live-design-workspace, live-w3-r1 |
| H7 | `design/dc/PayAdvances.view.tsx:142` (gen.) | "Advance details" + Approve/Reject + Recovery options | `/hrms/advances` | `hrms.advance.read` | decision `POST /v1/advance/requests/{id}/decision` [`@perm hrms.advance.approve`]; `…/disburse` [`@perm hrms.advance.disburse`] | live-design-payroll |
| H8 | `design/dc/PayAdvances.view.tsx:205` (gen.) | "Issue advance" (for self or someone else) | `/hrms/advances` | `hrms.advance.request.self`; others `hrms.advance.request.others` | `POST /v1/advance/requests` [`…request.self`], `POST /v1/advance/requests/on-behalf` [`…request.others`] | — |
| H9 | `design/dc/PayBank.view.tsx:152` (gen.) | bank file "{reference}" (read) | `/hrms/bank-disbursement` | `hrms.disbursement.read` | `GET /v1/payroll/disbursement/batches/{id}` | — |
| H10 | `design/dc/PayPli.view.tsx:134` (gen.) | "Edit PLI · {team}" (target, actual, payout) | `/hrms/pli` | `hrms.pli.target.write` or `hrms.pli.write` | `PUT /v1/pli/targets/{id}` [same] | — |
| H11 | `design/dc/PaySalary.view.tsx:199` (gen.) | "Add salary structure" / "Edit salary structure" | `/hrms/salary-structure` | `payroll.structure.manage` | `POST /v1/payroll/structures` [`payroll.structure.manage`] | live-design-payroll |
| H12 | `design/dc/PayslipDrawer.view.tsx:10` (gen.) | "Payslip" (lines, totals, PDF) | runs, payroll dashboard, `/me/payslips` and 8 more importers | admin `payroll.runs.read`; own payslip for staff | `GET …/payslip`, `…/payslip.pdf` | live-design-payroll, live-payroll-access, live-dead-entrypoints |
| H13 | `design/dc/ShiftRequests.view.tsx:271` (gen.) | "Ask for a different shift" | `/hrms/shifts` (own view) | `attendance.checkin.self` | `POST /v1/shifts/change-requests` [`attendance.checkin.self`] | — |
| H14 | `design/dc/ShiftRoster.view.tsx:203` (gen.) | "Assign a shift · {name}" / "Change shift · {name}" | `/hrms/shifts` (Roster) | `attendance.workforce.admin` | `POST /v1/shifts/employee/{employeeId}` | live-admin-actions |
| H15 | `design/dc/ShiftSchedules.view.tsx:189` (gen.) | "Add a shift" / "Edit {shift}" | `/hrms/shifts` (Schedules) | `attendance.workforce.admin` | `POST /v1/shifts`, `PUT /v1/shifts/{id}` [`attendance.workforce.admin`] | — |
| H16 | `modules/hrms/advance/AdvanceAdmin.tsx:91` | "Reject advance" (reason) | `/hrms/advances` | `hrms.advance.approve` | `POST /v1/advance/requests/{id}/decision` [`@perm hrms.advance.approve`] | live-money-modals |
| H17 | `AdvanceAdmin.tsx:100` | "Advance details": recovery schedule; defer, close early, write off | `/hrms/advances` (Recovery options) | read `hrms.advance.read`; defer `hrms.advance.approve`; close/write off `hrms.advance.foreclose` | `POST /v1/advance/{id}/skip-month` / `foreclose` / `write-off` | live-advance-admin |
| H18 | `attendance/EmployeeShiftAction.tsx:60` | "Change employee shift" | — | — | — | **dead: imported nowhere** |
| H19 | `attendance/StatusChangeDrawer.tsx:64` | "Change status" / "Not them?" | `/hrms/attendance` | `attendance.status.override` | `POST /v1/attendance/review/status`, `POST /v1/attendance/review/face-events/{id}/decision` [`attendance.status.override`]; server needs a reason ≥ 3 characters | — |
| H20 | `attendance/face/FaceEnrollDrawer.tsx:343` | "Enroll your face" / "Re-enroll your face" / "Enroll {name}’s face" (camera, 3 angles) | `/profile`, `/hrms/employees/:id` | self `attendance.face.enroll.self`; HR `attendance.face.admin.reset` | `POST /v1/attendance/face/enroll/start / sample / complete` or `/v1/attendance/face/admin/employees/{id}/enroll/*` | live-w3-faceenroll (9 dialog checks) |
| H21 | `Compliance.tsx:308` | "Add compliance obligation" | `/hrms/compliance` | `hrms.compliance.write` | `POST /v1/compliance/items` | live-w3-r3 |
| H22 | `Compliance.tsx:481` | "Schedule statutory filing" | `/hrms/compliance` | `hrms.compliance.write` | `POST /v1/compliance/filings` | live-compliance-modals, live-w3-r3 |
| H23 | `Compliance.tsx:721` | "Register POSH complaint" | `/hrms/compliance` | `hrms.compliance.posh` | `POST /v1/compliance/posh` | live-compliance-modals, live-w3-r3 |
| H24 | `dashboard/AdminDashboardContainer.tsx:396` | "Projects & Productivity" (read) | `/dashboard` | `hrms.project.read` | read only | live-design-dashboard, live-w3-r4 |
| H25 | `DocumentVault.tsx:229` | "Edit “{title}”" | `/hrms/documents` | `hrms.document.write` | `PUT /v1/document/documents/{id}` | live-w3-r3 |
| H26 | `DocumentVault.tsx:291` | "Add a document" (file or link, employee picker) | `/hrms/documents` | `hrms.document.write` | `POST /v1/document/upload` + `POST /v1/document/documents` | live-w3-r3, live-design-documents |
| H27 | `DocumentVault.tsx:393` | "Bulk upload documents" | `/hrms/documents` | `hrms.document.write` | as H26, per file | — |
| H28 | `employees/workspace/EmployeeExit.tsx:170` | "Edit separation details" | `/hrms/employees/:id?tab=exit` | `hrms.employee.write` | `PUT /v1/hrms/employees/{id}` | live-employee-exit, live-w3-r1 |
| H29 | `workspace/EmployeeJob.tsx:99` | "Edit Work Details" | `…?tab=job` | `hrms.employee.write` (`<Can>`) | `PUT /v1/hrms/employees/{id}` | — |
| H30 | `workspace/EmployeePayroll.tsx:100` | "Add Bank Account" | `…?tab=payroll` | server `@perm hrms.employee.bank.write` | `POST /v1/employees/{id}/profile/bank-accounts` | — |
| H31 | `workspace/EmployeePayroll.tsx:237` | "Salary structure" (CTC, effective from, tax regime) | `…?tab=payroll` | `payroll.structure.manage` | `POST /v1/payroll/structures` | live-w3-r1 |
| H32–H36 | `workspace/EmployeePersonal.tsx:100 / 266 / 349 / 431 / 519` | "Add Address" / "Add Education" / "Add Experience" / "Add Dependent" / "Add Emergency Contact" | `…?tab=personal` | server `@perm hrms.employee.profile.write` | `POST /v1/employees/{id}/profile/addresses / education / experience / dependents / emergency-contacts` | live-w3-r1 (Experience, Dependent) |
| H37 | `exit/ExitCenter.tsx:202` | "Start notice period" | `/hrms/exit` | `hrms.employee.write` | `POST /v1/hrms/employees/{id}/notice` | live-exit-center, live-w3-r2 |
| H38 | `ExitCenter.tsx:253` | "Separation details — {name}" | `/hrms/exit` | `hrms.employee.write` | `PUT /v1/hrms/employees/{id}` | live-w3-r2 |
| H39 | `ExitCenter.tsx:280` | "Mark {name} as exited" | `/hrms/exit` | `hrms.employee.write` | `POST /v1/hrms/employees/{id}/exit` | live-fnf-tabs |
| H40 | `expense/ReimbursementBatches.tsx:71` | "Build reimbursement batch" | `/hrms/expenses` (batches) | `hrms.reimb_batch.build` | `POST /v1/expense/reimbursement-batches` | expense-batches-live, live-w3-r4 |
| H41 | `ReimbursementBatches.tsx:96` | "{batch reference}": post, mark paid, cancel, revert claims | `/hrms/expenses` | read `hrms.reimb_batch.read`; post `…build`; mark paid / cancel / revert `…post` | `POST /v1/expense/reimbursement-batches/{id}/post / mark-paid / cancel / revert-claims` | expense-batches-live |
| H42 | `Expense.tsx:538` | "Reject claim" (reason) | `/hrms/expenses` | `hrms.expense.claim.approve` | `POST /v1/expense/claims/{id}/decision` [`@perm`] | live-money-modals |
| H43 | `FullAndFinal.tsx:110` | "Settlement details": components; approve, pay, cancel | `/hrms/fnf` | read `hrms.fnf.read`; actions `hrms.fnf.approve / pay / process` | `POST /v1/fnf/settlements/{id}/approve / pay / cancel` [`@perm`] | live-fnf-admin, live-fnf-tabs |
| H44 | `hiring/Interviews.tsx:88` | "Schedule an interview" / "Change interview" | `/hrms/hiring` | `hrms.hiring.interview.write` | `POST /v1/hiring/candidates/{id}/interviews`, `PUT /v1/hiring/interviews/{id}` | live-w3-r1 |
| H45 | `Interviews.tsx:161` | "Submit your scorecard" / "Your scorecard" | `/hrms/hiring`, `/me/interviews` | `hrms.hiring.interview.self` or `hrms.hiring.read` | `PUT /v1/hiring/interviews/{id}/scorecard` | live-w3-r1 |
| H46 | `Interviews.tsx:254` | candidate "{name}" card (read) | `/hrms/hiring` | `hrms.hiring.read` | read only | — |
| H47 | `Hiring.tsx:271` | "Edit Requisition" | `/hrms/hiring` | `hrms.hiring.write` | `PUT /v1/hiring/requisitions/{id}` | — |
| H48 | `letters/GenerateLetterDrawer.tsx:37` | "Generate letter" (template, employee, preview) | `/hrms/letters` | `hrms.letters.generate` | `POST /v1/letters/generate` | letters-admin-live |
| H49 | `NotificationTemplates.tsx:179` | "New template" / "Edit template" | `/hrms/notification-templates` | `hrms.notiftemplate.write` | `POST /v1/notiftemplate/templates`, `PUT …/{id}` | live-design-hrsetup |
| H50 | `onboarding/AssetHistory.tsx:12` | "History · {tag}" (read) | `/hrms/onboarding/instances` (Assets) | `hrms.onboarding.asset.read` or `…instance.write` | `GET /v1/onboarding/assets/{id}/history` | live-assets-browser |
| H51 | `onboarding/AssetsTab.tsx:126` | "Register an asset" | same | `hrms.onboarding.asset.write` or `…instance.write` | `POST /v1/onboarding/assets` | live-assets-browser |
| H52 | `AssetsTab.tsx:146` | "Assign {tag}" / "Take back {tag}" | same | same | `POST /v1/onboarding/assets/{id}/assign / return` | live-assets-browser |
| H53 | `onboarding/HireDetails.tsx:68` | "Hire details" | `/hrms/onboarding/instances/:id` | `hrms.onboarding.instance.write` | `PUT /v1/onboarding/instances/{id}/hire-details` | live-w3-r1 |
| H54 | `onboarding/TemplateDetail.tsx:34` | "Edit template" | `/hrms/onboarding/templates/:id` | `hrms.onboarding.template.write` | `PUT /v1/onboarding/templates/{id}` [`@perm`] | — |
| H55 | `TemplateDetail.tsx:62` | "Add a task" | same | same | `POST /v1/onboarding/templates/{id}/tasks` [`@perm`] | — |
| H56 | `onboarding/Templates.tsx:34` | "New checklist template" | `/hrms/onboarding` | same | `POST /v1/onboarding/templates` [`@perm`] | — |
| H57 | `payroll/PayrollContainer.tsx:542` | "PLI awards" (list, decide, pay) | `/hrms/pli` | `hrms.pli.read`; actions `hrms.pli.write` | `POST /v1/pli/awards/{id}/decision / pay` | live-design-payroll |
| H58 | `performance/AdminCycles.tsx:55` | "Create review cycle" | `/hrms/performance` | `hrms.performance.write` | `POST /v1/performance/cycles` | live-w3-r4 |
| H59 | `AdminCycles.tsx:85` | "{cycle}": activate, start reviews, close | `/hrms/performance` | activate `hrms.performance.write`; start/close `hrms.appraisal.initiate` | `POST /v1/performance/cycles/{id}/activate / initiate / close` | performance-admin-live |
| H60 | `performance/AdminKpis.tsx:82` | "Create company KPI" / "Edit KPI" | `/hrms/performance` | `hrms.kpi.manage` | `POST /v1/performance/kpis`, `PUT …/{id}` | live-w3-r4, performance-admin-live |
| H61 | `AdminKpis.tsx:120` | "KPI progress & history": record progress, drop | `/hrms/performance` | progress `hrms.performance.write` or `hrms.kpi.progress`; drop `hrms.kpi.manage` | `PUT …/{id}/progress`, `DELETE …/{id}` | performance-admin-live |
| H62 | `performance/AdminReviews.tsx:36` | "Employee review" (read) | `/hrms/performance` | `hrms.performance.read` | read only | live-design-performance |
| H63 | `performance/EmployeePerformancePage.tsx:103` | "Review" (read) | `/hrms/performance/employees/:id` | `hrms.performance.read` | read only | — |
| H64 | `reports/ReportSchedules.tsx:155` | "New scheduled email" / "Edit scheduled email" | `/hrms/reports` | `hrms.report.schedule.manage` (class-level guard) | `POST /v1/reports/schedules`, `PUT …/{id}` | — |
| H65 | `pages/AuditLogs.tsx:125` | "Event details" (read) | `/audit-logs` | `audit.read` | read only | — |

### 4.2 Other side panels (8 live) — ui-kit `Drawer` and hand-rolled

| # | Where | Title / purpose | Page | Who can open it | What it calls [guard] | Tests |
|---|---|---|---|---|---|---|
| D1 | `pages/Roles.tsx:107` (ui-kit Drawer) | "{role} — Permissions" (picker) | `/roles` | `rbac.role.write` | `PUT /v1/rbac/roles/{id}/permissions[?acknowledgeRisk=true]` [`rbac.role.write`] | live-design-access |
| D2 | `Roles.tsx:433` (ui-kit Drawer) | create / edit / duplicate a role | `/roles` | `rbac.role.write` | `POST /v1/rbac/roles`, `PUT …/{id}`, `POST …/{id}/duplicate` | live-design-access |
| D3 | `Roles.tsx:485` (ui-kit Drawer) | "Delete “{role}”?" — a confirm shown as a drawer, lists holders | `/roles` | `rbac.role.write` | `DELETE /v1/rbac/roles/{id}` | — |
| D4 | `pages/users/ManageAccessDrawer.tsx:83` (ui-kit Drawer) | "Manage access — {name}" (roles; extra permissions via `UserPermissionOverrides`) | `/users` | `workspace.users.manage`; overrides `rbac.access.manage-overrides` | `POST /v1/workspace/users/{id}/roles`, `DELETE …/roles/{code}`, `PUT /v1/workspace/users/{id}/permissions` | live-design-access, live-payroll-access, live-w3-r4 |
| X1 | `employees/EmployeeForm.tsx:1005` (hand-rolled) | legacy full form "Edit Employee" (Basic → Financial; opened from H6's "full form" link) | `/hrms/employees/:id` | `hrms.employee.write` | `PUT /v1/hrms/employees/{id}` (+ inline creates Y2) | live-w3-r1 line 183 finds it by **`.ut-card` + heading "Edit Employee"** |
| X2 | `leave/HolidayCalendar.tsx:72` (hand-rolled) | "Add Holiday" | `/hrms/leave?view=holidays` | `settings.holidays.write` | `POST /v1/settings/holidays` | live-w3-r2 line 189 finds it by **`div.ut-card` + `h3` "Add Holiday"** |
| X3 | `leave/LeaveTypes.tsx:107` (hand-rolled) | "Add Leave Type" / "Edit Leave Type" | `/hrms/leave?view=types`; `/hrms/policies` (Leave rules tab, for people who are not policy admins) | `leave.type.write` | `POST /v1/leave/types`, `PUT …/{id}` | — |
| X4 | `letters/DistributionWizard.tsx:116` (hand-rolled) | "New Distribution" — a 4-step panel (Template, Recipients, Message, Confirm), already the design's stepper idea | `/hrms/letters` | `hrms.letters.distribute` | `POST /v1/letters/distributions` | — |

### 4.3 Centred dialogs (ui-kit `Modal` 23, hand-rolled 7)

| # | Where | Title / purpose | Page | Who can open it | What it calls [guard] | Tests |
|---|---|---|---|---|---|---|
| M1 | `design/dc/AdminDashboard.view.tsx:927` (gen.) | "New notice" / "Edit notice" | `/dashboard` | `org.company.write` | `POST /v1/admin/dashboard/notices`, `PUT …/{id}` [`org.company.write`] | live-design-dashboard, live-notices-browser |
| M2 | `design/dc/CompaniesPage.view.tsx:743` (gen.) | "Archive {name}?" / "Restore {name}?" / blocked "Can’t archive yet" (only an **OK** button) | `/hrms/companies` | `org.company.write` | `DELETE /v1/hrms/companies/{id}`, `DELETE /v1/hrms/branches/{id}`, `POST /v1/hrms/companies/{id}/restore` | live-design-companies, live-company-restore |
| M3 | `design/dc/EmployeeWorkspace.view.tsx:575` (gen.) | "Confirm Probation" / "Extend Probation" / "Start Notice Period" / "Mark Employee as Exited" (danger) / "Cancel Notice Period", with date and exit-type fields | `/hrms/employees/:id` | `hrms.employee.write` | `POST /v1/hrms/employees/{id}/confirm / notice / exit / cancel-notice`, `POST /v1/probation/employees/{id}/extend` | live-design-workspace, live-w3-r1 ("Confirm Probation") |
| M4 | `design/dc/NewRunModal.view.tsx:12` (gen.) | "New payroll run" (company, month); `preventOutsideClose` while saving | `/hrms/payroll/runs` | `payroll.runs.manage` | `POST /v1/payroll/runs` | live-design-payroll |
| M5 | `design/dc/PayAdvances.view.tsx:244` (gen.) | "Approve {name}’s advance?" | `/hrms/advances` | `hrms.advance.approve` | decision [`@perm`] | — |
| M6 | `design/dc/PayBank.view.tsx:184` (gen.) | "Confirm transfer for {bank}?" + UTR field | `/hrms/bank-disbursement` | `hrms.disbursement.post` | `POST /v1/payroll/disbursement/batches/{id}/mark-paid` | — |
| M7 | `design/dc/PayPli.view.tsx:160` (gen.) | "Set monthly targets" | `/hrms/pli` | `hrms.pli.target.write` / `hrms.pli.write` | `POST /v1/pli/targets` | — |
| M8 | `design/dc/PayrollRunPage.view.tsx:341` (gen.) | "Process payroll?" / "Re-process payroll?" / "Lock this payroll run? Payslips become final." / "Reopen payroll?" / "Prepare bank disbursement?" / "Mark {run} as paid?" | `/hrms/payroll/runs/:id` | process `payroll.runs.manage`; lock/reopen `payroll.runs.lock`; bank `hrms.disbursement.build`; paid `hrms.disbursement.post` | `POST /v1/payroll/runs/{id}/process / lock / reopen`, `POST /v1/payroll/disbursement/batches`, `…/{id}/mark-paid` | live-design-payroll, live-payroll-access |
| M9 | `design/dc/PaySalary.view.tsx:258` (gen.) | "Bulk revise CTC?" | `/hrms/salary-structure` | `payroll.structure.bulk-revise` | `POST /v1/payroll/structures/bulk-revise` (+ `/preview`) | — |
| M10 | `design/dc/PaySettings.view.tsx:940` (gen.) | "Discard unsaved changes?" (leaving payroll settings) | `/hrms/payroll/settings` | — | none | — |
| M11 | `design/settings/SettingsKit.tsx:355` | `SettingsLeaveModal` "Discard unsaved changes?" | — | — | none | **unused export** |
| M12 | `Compliance.tsx:549` | "Mark filing as filed" | `/hrms/compliance` | `hrms.compliance.write` | `POST /v1/compliance/filings/{id}/file` | live-compliance-modals |
| M13 | `Compliance.tsx:788` | "{verb} complaint {no}" ("Closing a complaint is final") | `/hrms/compliance` | `hrms.compliance.posh` | `POST /v1/compliance/posh/{id}/status` | live-compliance-modals |
| M14 | `leave/LeaveYearEnd.tsx:110` | "Run the {year} carry forward?" | `/hrms/leave?view=yearend` | `hrms.leave.yearend.run` | `POST /v1/leave/year-end/carry-forward` | — |
| M15 | `Leave.tsx:87` | "Cancel this leave?" | `/hrms/leave` | `leave.request.self` | `POST /v1/leave/{id}/cancel` | live-design-leave |
| M16 | `wfh/ApplyWfh.tsx:78` | "Cancel this request?" (work from home) | `/me/wfh` | `wfh.request.self` | `POST /v1/wfh/{id}/cancel` | — |
| M17 | `pages/branding/BrandingTab.tsx:186` | "Remove the square mark?" / "Remove the wide logo?" | `/settings/branding` | `settings.branding.write` | `DELETE /v1/workspace/branding/{kind}` | — |
| M18 | `pages/Roles.tsx:196` | "Add high-risk permissions?" | `/roles` | `rbac.role.write` | the D1 save with `acknowledgeRisk=true` | — |
| M19 | `pages/SettingsDangerZone.tsx:94` | "Schedule deletion of this workspace?" / "Schedule a reset of this workspace?" | `/settings/danger` | `workspace.lifecycle.manage` | `POST /v1/workspace/lifecycle-requests` | — |
| M20 | `pages/users/InviteWorkspaceUserModal.tsx:63` | "Invite Workspace User" | `/users` | `workspace.users.manage` | `POST /v1/workspace/users/invite` | — |
| M21 | `ManageAccessDrawer.tsx:183` | "Remove last role?" | `/users` | `workspace.users.manage` | `DELETE /v1/workspace/users/{id}/roles/{code}` | — |
| M22 | `ManageAccessDrawer.tsx:213` | "Give the {role} role?" | `/users` | same | `POST /v1/workspace/users/{id}/roles` | — |
| M23 | `pages/users/UserPermissionOverrides.tsx:212` | "Give a high-risk permission?" | `/users` | `rbac.access.manage-overrides` | `PUT /v1/workspace/users/{id}/permissions` | — |
| Y1 | `employees/EmployeeForm.tsx:912` (hand-rolled) | "You've run out of seats" (replaces the form after a 402) | `/hrms/employees/:id` | — | none | — |
| Y2 | `employees/InlineCreateModals.tsx:52` (`ModalShell`) → 5 dialogs at lines 201 / 288 / 397 / 508 / 586 | "Add Department" / "Add Designation" / "Add Geofence Zone" / "Add Company" / "Add Branch" — opened from the legacy form's "+ Add new"; **portalled so the form underneath keeps what was typed**; z 200/210 over the form's 110 | `/hrms/employees/:id` | backend: `hrms.department.write`, `hrms.designation.write`, `org.geofence.write`, `org.company.write` (companies and branches) | `POST /v1/hrms/departments / designations / companies / branches`, `POST /v1/attendance/geofence/zones` | — |
| Y3 | `employees/workspace/shared.tsx:200` (`ActionModal`) | generic action modal | — | — | — | **dead: never used** |

### 4.4 Master design overlays (`design/master/MasterDesign.tsx`; pages `/hrms/master/*`, `/hrms/employees`, `/hrms/policies` for policy admins, `/hrms/payroll/components`)

- **Form drawers (`RecordForm`, 12):** line 315 "Add employee" / "Edit {name}" · 347 "Add staffing agency" · 374 "Add classification" / "{name} rules" · 398 "Add company" · 425 "Add branch" · 459 "Add department" / "Add sub-team" · 487 "Add designation" · 511 "Add grade" · 543 "Add shift" / "{name} shift" · 574 "Add leave type" · 611 "Publish a policy" · 653 "Add salary component".
- **Profile drawer:** line 288 "Employee profile" (with Start exit).
- **Modals (6):** 278 "Start exit for {name}?" · 338 "End contract with {name}?" · 449 "Assign a head to …" / "Change head of …" · 603 "Discard {draft policy}?" · 638 "Delete {component}?" and "Switch off {component}?".
- **Popovers:** `Popover`, `Dropdown` (with search), `Menu` (row actions, "Coming soon" items), `Tip` (hover help), `Toasts`.
- **Saves:** `modules/hrms/master/masterSync.ts` diffs each change and calls the entity's endpoint (employees, contractors, classification rules, companies, branches, departments, designations, grades, shifts, leave types, policies, salary components, statutory). **Gates:** `MasterContainer.tsx:117–125` (`hrms.employee.read/write/import/invite`, `hrms.contractor.read/write`, `org.company.read/write`, `hrms.department.*`, `hrms.designation.*`, `hrms.branch.write`, `hrms.grade.write`, `hrms.employment_type.write`, `attendance.workforce.admin`, …).
- **Tests on its classes:** live-design-master (`#utm-portal .drawer`, `.modal`, `.pop .opt`, `.field`, `.ddb`, `.tgl`, `.toast`), live-w3-access (`.drawer .dr-b`, `.field`, `.ddb`, `.pop .opt`, `.toast`), live-w3-r1 (`.pop .opt`, `.modal[role=dialog]`, dialog names "Add employee", "Add staffing agency", "Publish a policy"), live-company-restore (`.ddb`, `#utm-portal .pop .opt`).

### 4.5 Confirms through `useConfirmDialog()` (14)

| # | Where | Title | Calls [guard] | Tests |
|---|---|---|---|---|
| C1 | `advance/AdvanceAdmin.tsx:81` | "Record {amount} as disbursed?" | `POST /v1/advance/requests/{id}/disburse` [`@perm hrms.advance.disburse`] | — |
| C2 | `AdvanceAdmin.tsx:131` | "Close with {amount} received?" / "Write off {amount}?" / "Defer installment {n}?" | `POST /v1/advance/{id}/foreclose / write-off / skip-month` | live-advance-admin |
| C3 | `dashboard/AdminDashboardContainer.tsx:386` | "Archive notice?" | `DELETE /v1/admin/dashboard/notices/{id}` [`org.company.write`] | live-notices-browser |
| C4 | `exit/ExitCenter.tsx:68` | "Withdraw {name}'s notice?" | `POST /v1/hrms/employees/{id}/cancel-notice` | live-exit-center |
| C5 | `Expense.tsx:717` | "Deactivate “{policy}”?" | `DELETE /v1/expense/policies/{id}` [`hrms.expense.policy.write`] | — |
| C6 | `hiring/Interviews.tsx:231` | "Cancel “{title}” with {candidate}?" | `POST /v1/hiring/interviews/{id}/cancel` | — |
| C7 | `Hiring.tsx:432` | "Convert {name} to an employee?" | `POST /v1/hiring/candidates/{id}/convert` [`hrms.hiring.candidate.write` **and** `hrms.employee.write`] | live-candidate-conversion |
| C8 | `Integrations.tsx:51` | "Remove {name}?" | `DELETE /v1/integration/connections/{id}` | — |
| C9 | `NotificationTemplates.tsx:116` | "Delete “{name}”?" | `DELETE /v1/notiftemplate/templates/{id}` | — |
| C10 | `reports/ReportSchedules.tsx:59` | "Delete this scheduled email?" | `DELETE /v1/reports/schedules/{id}` | — |
| C11 | `pages/SettingsDangerZone.tsx:117` | "Cancel the workspace {deletion / reset}?" | `POST /v1/workspace/lifecycle-requests/{id}/cancel` | — |
| C12 | `pages/SettingsSecurity.tsx:205` | "Sign out {device}?" | `DELETE /v1/me/security/sessions/{id}` | — |
| C13 | `SettingsSecurity.tsx:209` | "Sign out every other session?" | `POST /v1/me/security/sessions/sign-out-others` | — |
| C14 | `SettingsSecurity.tsx:260` | "Turn off two-factor for {name}?" | `POST /v1/workspace/security/members/{userId}/mfa/reset` [`workspace.security.manage`] | — |

### 4.6 Native `window.confirm` (23) and `window.prompt` (2)

| # | Where | Text | Calls [guard] | Tests that answer the native dialog |
|---|---|---|---|---|
| N1 | `DocumentVault.tsx:165` | "Delete “{title}”? This can’t be undone…" | `DELETE /v1/document/documents/{id}` [`hrms.document.write` / `…write.self`] | **live-design-documents** (`once('dialog', accept)`) |
| N2 | `Learning.tsx:256` | "Drop {who} from “{program}”?…" | `POST /v1/learning/enrollments/{id}/admin-drop` [`hrms.learning.write`] | — |
| N3 | `Learning.tsx:339` | "Leave “{program}”?…" | `POST /v1/learning/enrollments/{id}/drop` [`hrms.learning.enroll.self`] | **live-design-learning** |
| N4 | `Learning.tsx:438` | "Withdraw your proposal for {skill}?…" | `POST /v1/learning/skill-assessments/{id}/withdraw` | — |
| N5 | `learning/ProgramDetail.tsx:49` | "Leave “{title}”?…" | drop (as N3) | — |
| N6 | `ProgramDetail.tsx:54` | "Cancel “{title}”? Everyone still enrolled is dropped…" | `PUT /v1/learning/programs/{id}` (status CANCELLED) [`hrms.learning.write`] | — |
| N7 | `ProgramDetail.tsx:55` | "Mark “{title}” completed?…" | same (status COMPLETED) | — |
| N8 | `Policies.tsx:260` | "Delete "{shift}"?…" (Shift rules tab) | `DELETE /v1/shifts/{id}` [`attendance.workforce.admin`] | — |
| N9 | `Policies.tsx:731` | "Archive "{policy}"?…" | `POST /v1/policy/policies/{id}/archive` [`hrms.policy.write`] | — |
| N10 | `compliance/InspectorSessions.tsx:112` | "Revoke {inspector}’s access now?…" | `POST /v1/compliance/inspector-sessions/{id}/revoke` | **live-inspector-browser** |
| N11 | `employees/EmployeeForm.tsx:386` | "You have unsaved employee details. Leave this page and lose your changes?" — **synchronous navigation guard inside a capture-phase click listener** | none | — |
| N12 | `leave/HolidayCalendar.tsx:169` | "Remove "{name}" from the holiday calendar?" | `DELETE /v1/settings/holidays/{id}` [`settings.holidays.write`] | **live-w3-r2** (lines 207 and 315, incl. cleanup) |
| N13 | `leave/LeaveTypes.tsx:338` | "Deactivate "{type}"?…" | `DELETE /v1/leave/types/{id}` [`leave.type.write`] | — |
| N14 | `onboarding/TemplateDetail.tsx:90` | "Delete “{task}” from this template?…" | `DELETE /v1/onboarding/templates/{id}/tasks/{taskId}` | — |
| N15 | `onboarding/Templates.tsx:56` | "Archive “{name}”?…" | `DELETE /v1/onboarding/templates/{id}` | — |
| N16 | `payroll/BankDisbursement.tsx:272` | "Deactivate bank profile…?" | `PUT /v1/payroll/bank-profiles/{id}` [`hrms.bank_profile.manage`] | — |
| N17 | `BankDisbursement.tsx:282` | "Delete bank profile…?" | `DELETE /v1/payroll/bank-profiles/{id}` | — |
| N18 | `BankDisbursement.tsx:348` | "Cancel this disbursement batch…?" | `POST /v1/payroll/disbursement/batches/{id}/cancel` [`hrms.disbursement.post`] | — |
| N19 | `settings/HrConfigurationPage.tsx:196` | "Discard your unsaved changes for this company?" (company switch) | none | — |
| N20 | `pages/DelegationCard.tsx:120` | "Remove this delegation?…" | `DELETE /v1/me/delegation/{id}` | — |
| N21 | `pages/MyDocumentsCard.tsx:179` | "Delete your {type}?" | `DELETE /v1/document/documents/{id}` [`hrms.document.write.self`] | — |
| N22 | `pages/SettingsDocumentTypes.tsx:145` | "Deactivate "{type}"?…" | `DELETE /v1/document/types/{id}` [`hrms.document.type.write`] | — |
| N23 | `pages/Plan.tsx:518` | "Cancel this subscription?…" | billing (`/plan`), **outside HRMS** | — |
| P1 | `employees/workspace/EmployeeDocuments.tsx:194` | prompt "Reason for rejection?" (≥ 3 characters, else silently nothing) | `POST /v1/document/documents/{id}/reject` [`hrms.document.verify`] | — |
| P2 | `payroll/BankDisbursement.tsx:330` | prompt "Bank UTR / payment reference (required):" | `POST /v1/payroll/disbursement/batches/{id}/mark-paid` [`hrms.disbursement.post`] | — |

`live-money-modals.mjs:168` asserts **no** native dialog appears on Expenses and Advances. Keep that check.

Inline confirms that are not overlays (keep as they are, restyle only): the face-reset "are you sure" inside the employee workspace card (`EmployeeWorkspace.tsx:187`, `resetAsk`).

### 4.7 Popovers, menus, listboxes, tooltip

| # | Where | Purpose | Contract to keep |
|---|---|---|---|
| PO1 | `shared/components/calendar` (`DateField`, `MonthField`, `DateRangeField`; also `design/dc/DatePicker` wraps it) | every date field (67 in 41 files) | `role="dialog"` names "Choose date" / "Choose month" / "Choose date range" (used by 16 live scripts); focus model; Escape capture; z above every panel and dialog; phone sheet |
| PO2 | `design/dc/DashCalendar.view.tsx:12` | dashboard date chip | name "Choose dashboard date" (live-design-dashboard, live-w3-calendar) |
| PO3 | `design/dc/TimePicker.view.tsx:40` | time fields (fix requests, shift schedules) | role/name, listboxes, z 1200 |
| PO4 | `design/dc/MilestonesCard.tsx:136–160` | milestones range menu | `role="menu"` + `menuitemradio`, name "Choose a date range" (live-w3-milestones) |
| PO5 | `design/dc/WorkforceAnalytics.tsx:58–59` | export menu | `aria-haspopup="menu"`, `role="menu"` |
| PO6 | `modules/hrms/reports/ReportKit.tsx:88–92` | report export menu | same (live-design-reports uses menu roles) |
| PO7 | `design/dc/CompaniesPage.view.tsx:86–91` | company picker (`role="dialog"` "Choose a company" + listbox "Companies") | becomes the design's "Dropdown with search" in Phase 5 |
| PO8 | `design/dc/EmployeeWorkspace.view.tsx:104` | lifecycle actions menu by status | `role="menu"` (live-design-workspace, live-employee-exit, live-w3-r1 use menu roles) |
| PO9 | `modules/hrms/onboarding/Instances.tsx:57–62` | row actions menu | `aria-label="Row actions"`, `role="menu"` |
| PO10 | `shared/components/hr.tsx:505` `HrSelect` | custom select (25 files) | `aria-haspopup="listbox"`, `role="option"`, `aria-selected` |
| PO11 | `design/shell/ShellChrome.tsx:247` `DesignTooltip` | every `data-tip` | pointer-events none, above panels |
| PO12 | Master `Popover` / `Dropdown` / `Menu` / `Tip` | Master pages | `#utm-portal .pop .opt` (4 tests) |

### 4.8 Shell pop-ups (Phase 1; details in `shell.md`)

Profile menu (`PlatformShell.tsx:595–660, 728–734`; live-settings-restored reads it through `.z-dropdown .w-56`), notifications popover (`ShellNotificationBell`, `PlatformShell.tsx:805–930`), Advanced search dialog (`PlatformShell.tsx:617–630`, name "Advanced search", `data-testid="advanced-search"`), phone search sheet (`TopBarSearch.tsx:312`, name "Search"), phone navigation drawer (`ShellChrome.tsx:211`, "Close navigation"). DECISIONS item 11 removes the header gear and the profile menu.

### 4.9 Dead or unused (do not migrate; list for approval)

`attendance/EmployeeShiftAction.tsx` (H18), `employees/workspace/shared.tsx` `ActionModal` (Y3), `SettingsLeaveModal` (M11, exported, unused), `shared/components/CommandPalette.tsx`, `shared/components/NotificationPanel.tsx`, `shared/layouts/DashboardLayout.tsx` and `shared/layouts/Header.tsx` (never mounted), `packages/ui-kit/src/components/Modal.tsx` and `Drawer.tsx` (not exported), and the Tabler Icons webfont `<link>` in `apps/platform/index.html` (0 uses of `ti ti-*`).

---

## 5. Contracts the new SidePanel, Dialog and Popover must keep

1. **One `role="dialog"` per open pop-up, named by its visible title.** The live scripts call `getByRole('dialog')` 124 times in 39 files: 33 distinct names (§8.2), and 58 calls without a name in 24 files. A wrapper that also carries `role="dialog"` would break the unnamed ones with strict-mode errors.
2. **Close button names.** `HrDrawer`: "Close panel" (expense-batches-live, live-advance-admin, live-fnf-admin, live-w3-r1, performance-admin-live). Radix modals: "Close" (sr-only). The design says "Close". The in-progress kit defaults to "Close", so the `HrDrawer` wrapper must pass `closeLabel="Close panel"` (or those 5 tests change).
3. **Focus:** trap Tab inside; move focus in on open; return it to the opener on close (`HrDrawer` and Radix both do; the prototype panel doesn't).
4. **Escape layering.** The calendar catches Escape at window capture and stops it, so only the calendar closes (live-w3-r1 asserts "Escape closes only the calendar, not the drawer"). Master drawers ignore Escape while a popover or modal is open. The kit's `useEscape` checks `defaultPrevented` and the top-most layer: keep that.
5. **Busy guards.** 18 `HrDrawer` call sites refuse to close while saving (`onClose={() => { if (!x.isPending) onClose() }}`), and others guard inside their own close handler; `NewRunModal` sets `preventOutsideClose` while busy; confirm buttons disable while pending. The kit's `busy` prop must block Escape, backdrop and the close button.
6. **Stacking.** Nested panels (Advance details → Reject advance), dialogs over panels, the calendar and TimePicker over both, the confirm dialog over everything, toasts over panels. Keep the order in §3.
7. **Portals that keep state.** `InlineCreateModals` must stay portalled above the legacy form without unmounting it, or the typed input is lost (client ask, comment in the file).
8. **The `backdrop-filter` trap.** An element with `backdrop-filter` becomes the containing block of its `position:fixed` descendants (14 drawers broke on 23 Aug 2026). The backdrop must be a **sibling** of the panel. `HrDrawer`'s footer has `backdrop-blur-md` today: no fixed popover may render inside it.
9. **Widths.** Panels are sized to content today: `max-w-md` 448, `lg` 512 (default), `xl` 576, `2xl` 672, `3xl` 768 (Advance details, batch detail), `4xl` 896 (PLI awards table). The design's 680px is the stepper panel. Keep per-use widths.
10. **Radix centring.** Keep the framer-motion `x/y` centring in `Overlay.tsx` (see its comment).
11. **Steps keep their input.** The README says typed input survives step changes. `EmployeeForm` and `DistributionWizard` keep step state in the parent; the kit stepper hides panes instead of unmounting them (good).
12. **Browser-native prompts stay native:** `beforeunload` warnings (EmployeeForm, EmployeeImport, SettingsKit) cannot be styled.
13. **No data router.** The app uses `<BrowserRouter>`; `useBlocker` throws there (EmployeeForm comment, lines 340–347). A "Discard unsaved changes?" Dialog for in-app navigation must use the existing pattern (click capture + `beforeunload`), not `useBlocker`.
14. **Copy in titles is what tests match.** Several titles are Title Case today ("Edit Work Details", "Add Holiday", "Confirm Probation", "Add Experience"). If titles are changed to sentence case (the copy rule), update the tests listed in §8.2 in the same change.

---

## 6. Phase 7 conversion plan (recommended order)

| Step | What | Instances | Call-site edits | Tests to touch |
|---|---|---|---|---|
| 1 | Rebuild **`HrDrawer`** on the kit `SidePanel`, same props (`title`, `onClose`, `footer`, `children`, `width`), same contracts (§5), map `max-w-*` to pixel widths, `closeLabel="Close panel"`, heading level kept or tests updated | 65 (incl. 15 in generated views) | none | none if names and "Close panel" stay |
| 2 | Restyle ui-kit **`Overlay.tsx`** `Modal` and `Drawer` with the tokens (radius 12 for Modal, square Drawer with 1px left line, gradient-blur backdrop, 500/600 weights), keeping Radix and the centring | 27 (10 in generated views) | none | none |
| 3 | Rebuild **`ConfirmDialogProvider`** on the kit `Dialog` (danger tone, a "blocked, OK only" variant, token colours instead of `#059669/#DC2626`); make a second request resolve the first as `false` instead of dropping it | 14 | none | none |
| 4 | Replace **`window.confirm`** with `useConfirmDialog()` (same wording as title + body, a verb as the button) | 20 (N1–N10, N12–N18, N20–N22; N11 and N19 are step 6; N23 is billing, outside HRMS) | 1–3 lines each | live-design-documents, live-design-learning, live-inspector-browser, live-w3-r2 (twice): click the Dialog's button instead of `page.once('dialog')` |
| 5 | Replace **`window.prompt`** P1, P2 with a Dialog + required text field (P1 ≥ 3 characters, P2 required) | 2 | small | — |
| 6 | Keep or rebuild the two **guards**: N19 can await a Dialog; N11 is synchronous (question 1) | 2 | — | — |
| 7 | Restyle **Master** through `master.css` (`.utm .scrim`, `.drawer`, `.dr-*`, `.modal`, `.md-*`, `.pop`, `.toast`, weights 800 → 600, tokens, 12px radius, square drawer, gradient backdrop). Changing `MasterDesign.tsx` itself goes through `scripts/master-patches.mjs` | 19 + popovers | none | none if classes stay |
| 8 | Replace the **hand-rolled** ones with kit components: X1 (legacy form), X2, X3, X4 (kit stepper), Y1, Y2 (keep the portal) | 10 | per file | live-w3-r1:183 and live-w3-r2:189 → `getByRole('dialog', { name })` |
| 9 | **Popovers and menus:** re-token `calendar.css`, TimePicker, DashCalendar (colours, radius 12, popover shadow, font, dark); hand-rolled menus → kit `Menu` keeping `role="menu"` / `menuitemradio`; company picker → Dropdown with search (Phase 5) | — | small | none if roles and names stay |
| 10 | **Toasts:** one kit Toast (bottom centre, 360px, 2.6 s success, errors stay 6–8 s as today); keep `role="status"`/`"alert"`; Master keeps `.toast` or tests change | 5 systems | hooks keep their APIs | live-design-master, live-w3-access, live-directory-export (`.toast`) |

Generated views (`design/dc/*.view.tsx`) say "Do not edit by hand"; steps 1–2 reach them without edits. Re-running `design-build.mjs` would overwrite any hand edit (foundation §14.11).

---

## 7. Test inventory

### 7.1 vitest (unit) — 12 files, 93 tests, all logic, no DOM

Run per file (the rules forbid running vitest over the whole repo: without a config it also picks up Playwright specs). There is **no jsdom and no Testing Library** in the pnpm store, so component tests would need new dev dependencies (network install and a lockfile change).

| File | Tests | Covers | Redesign work that touches it |
|---|---|---|---|
| `core/tenant/workspaceBranding.test.ts` | 5 | branding load backoff, public fallback | none |
| `design/dc/milestoneRange.test.ts` | 8 | milestone presets, custom ranges, menu labels | dashboard milestones card |
| `layouts/railLit.test.ts` | 14 | which rail item is lit, session memory | shell (new rail groups and My work keys, DECISIONS 11) |
| `modules/hrms/api/useBulkImport.test.ts` | 6 | import error parsing | none |
| `modules/hrms/compliance/inspectorCsv.test.ts` | 2 | CSV formula guard | none |
| `modules/hrms/dashboard/dashboardDate.test.ts` | 8 | `?date=` rules, IST day end | dashboard |
| `modules/hrms/letters/lettersView.test.ts` | 7 | letters hub views per permission | letters page |
| `providers/QueryProvider.test.ts` | 6 | retry rules | none |
| `shared/components/calendar/dateMath.test.ts` | 7 | calendar maths | MonthCalendar (if built on `dateMath`) |
| `shared/hooks/greetingName.test.ts` | 5 | greeting name rule (client decision) | dashboard, Home |
| `shared/navigation/pageRegistry.test.ts` | 12 | menu and search access: staff vs admins, My team, locked modules, **My Attendance and personal Leave tabs not offered to admin roles** | shell, homes, My work |
| `shared/search/search.test.ts` | 13 | search ranking, access, actions, recents | ⌘K search |

### 7.2 Playwright spec suites (not in the gate)

- `e2e/tests` (`playwright.config.ts`, baseURL `demo.localhost:3001`, projects super-admin / hr-manager / dept-manager / finance-lead / employee): 47 files, 216 tests, role landings, restrictions, data scoping. `audits/dark-theme-audit.spec.ts` (6) only runs with `AUDIT=1` and saves screenshots.
- `e2e/live` (`playwright.live.config.ts`, baseURL `ravi.localhost:3003`): 11 files, 39 tests (prod sweeps, role matrix).
- Last touched 25 Sep (`0d270bac`). Several use `getByRole('tab')` (foundation §14). Treat as informational unless the lead adds them to the gate.

### 7.3 Backend tests

| Module | Unit classes | Test methods |
|---|---|---|
| `app/hrms-api` | 82 | 479 |
| `app/hrms-app` (7 unit + the IT classes) | 7 | 169 (incl. IT) |
| `platform/platform-rbac` | 8 | 34 |
| `platform/platform-notifications` | 5 | 39 |
| `platform/platform-saas` | 0 (tests named otherwise) | 4 |
| `modules/hrms-attendance` | 9 | 53 |
| `modules/hrms-employee` | 6 | 43 |
| `modules/hrms-payroll` | 4 | 31 |
| `modules/attendance-face` | 2 | 23 |
| `modules/hrms-leave` | 2 | 10 |
| `shared/hrms-core` | 2 | 12 |

Totals: **127 unit classes (`*Test`, `*Tests`) with 753 test methods** run by Surefire (`mvn test`); **27 integration classes (`*IT`) with 144 tests** run by Failsafe (`mvn verify`, Testcontainers Postgres 16). The Docker CLI is installed but the daemon is not running, so the IT tier cannot run here. Build and test commands go through `_tools/heavy.sh` (RULES.md).

### 7.4 Live scripts `e2e/recovery` (117)

Style: plain Node + Playwright `chromium`, `PASS name` / `FAIL name` lines, exit non-zero on a failure, API 4xx/5xx and page errors captured; logins through the real form (`input[type=email]`, `input[type=password]`, `button[type=submit]`); many read the database with `psql` to prove behaviour.

**API/DB-only (38 outside the gate + 3 in it): behaviour only, a restyle cannot break them.**
In the gate: `live-role-matrix`, `live-summary-notices`, `live-tenant-isolation`. Outside: `live-api`, `live-assets-calendar`, `live-backend-fixes`, `live-compliance-reports`, `live-concurrent-login`, `live-employee-import`, `live-hiring-offers`, `live-hr-lifecycle`, `live-inspection-documents`, `live-inspector`, `live-learning-dashboard`, `live-module-workflows`, `live-night-integration`, `live-offer-documents`, `live-offer-email`, `live-projects`, `live-shift-effective`, `live-time-workflows`, `live-w1a` … `live-w1h` (8), `live-w2a` … `live-w2i` (9), `live-workflows`, `performance-authorization-live`, and the seeder `seed-design-demo-data`.

**Browser scripts (76).** "Gate" = in `_tools/final-run.sh`. "Proves" = the behaviour checked (usually through the database or the API). "Leans on" = markup a restyle can break.

| Script | Gate | Pages | Proves | Leans on |
|---|---|---|---|---|
| expense-batches-live | ✓ | `/hrms/expenses` | build, post, pay a reimbursement batch | "Close panel"; dialog "Choose date"; `[aria-label="Expense views"]` |
| live-company-restore | ✓ | `/hrms/companies`, `/hrms/master/branches`, `/hrms/employees` | archive guards, Inactive view, restore (DB) | M2 dialog; Master `.ddb`, `#utm-portal .pop .opt` |
| live-compliance-modals | ✓ | `/hrms/compliance` | filing drawer, required fields, POSH modal (DB) | dialog names; `.utc-field`; Compliance views |
| live-dead-entrypoints | ✓ | `/me`, `/me/payslips`, `/me/salary`, `/hrms/settings…`, `/hrms/leave`, `/hrms/expenses` | links reach pages; real salary data | tab roles; headings (8) |
| live-design-access | ✓ | `/users`, `/roles`, `/audit-logs` | tiles, filters, grant/remove a role | D4 drawer; switch role; "Choose date"; Role views |
| live-design-attendance-admin | ✓ | `/hrms/muster-roll`, `/hrms/attendance/manual-entry` | not-marked vs absent, CSV export (DB) | `.utc-field`, `.utc-native` |
| live-design-attendance | ✓ | `/hrms/attendance`, `/hrms/att-analytics`, `/hrms/shifts` | module views and data | tab roles; H1 "Fix this day" |
| live-design-companies | ✓ | `/hrms/companies` | create/edit branch with geofence, HQ, archive; company legal name | H3/H4 openers; `getByRole('dialog').getByRole('button', {name:'Archive'})`; placeholders ("e.g. Mumbai Office", "MUM", "Mumbai"); `select` "Select state" |
| live-design-dashboard | ✓ | `/dashboard` | notices create/archive; cards | "Choose dashboard date"; M1; "Close" / "Close drawer" |
| live-design-documents | ✓ | `/hrms/documents`, `…/pending`, letters | add by link, employee sees it, HR deletes (DB) | **native confirm (N1)**; Document views |
| live-design-expenses | ✓ | `/hrms/expenses` | employee submits a claim; owner decides (DB) | Expense views |
| live-design-hrconfig | ✓ | `/hrms/settings`, `/hrms/settings/work-time` | settings saved (DB) | headings (6); computed style |
| live-design-hrsetup | ✓ | `/hrms/policies`, `/hrms/notification-templates`, `/hrms/integrations` | policies ack, templates CRUD (DB) | dialogs (H49); "Remove" |
| live-design-last | ✓ | `/hrms/pli`, `/hrms/employees/import`, `/hrms/bank-disbursement/setup` | kit headers, stepper | views, headings |
| live-design-learning | ✓ | `/hrms/learning`, `/hrms/performance` | program, roster, enrol/leave (DB) | **native confirm (N3)**; Learning views |
| live-design-leave | ✓ | `/me`, `/hrms/leave` | apply, cancel (DB) | M15; "Choose date"; Leave views |
| live-design-master | ✓ | 13 Master pages | add/edit/deactivate across Master (DB, 34 SQL checks) | **Master classes** (`#utm-portal .drawer`, `.modal`, `.pop .opt`, `.field`, `.ddb`, `.tgl`, `.toast`); switch role |
| live-design-onboarding | ✓ | onboarding instances | task delete keeps runs (API + DB) | views, headings |
| live-design-payroll | ✓ | runs, bank, salary, settings, PLI, advances, dashboard | module flows (DB) | `[role=dialog]` ×10; tab and switch roles; M4, M8, H7, H11, H12, H57 |
| live-design-performance | ✓ | `/hrms/performance` | views per role | Performance views |
| live-design-reports | ✓ | analytics, reports | numbers match DB | menu roles; headings |
| live-design-settings | ✓ | `/profile`, `/settings/*` | edits saved (DB) | switch role; "On this page" list |
| live-design-team | ✓ | `/team` | manager tiles, no 403s | minimal |
| live-design-workspace | ✓ | `/hrms/employees/:id` | edit, probation, notice, exit (DB) | H5, H6, M3, menu roles; `.utc-trigger`; "Choose date" |
| live-directory-search | ✓ | `/hrms/fnf` | the directory search API finds a new person by name, code and email with filters kept; the F&F employee picker finds them ("Selected: {name} ({code})") | tab role; picker text |
| live-employee-exit | ✓ | `/hrms/employees/:id`, `/hrms/fnf` | separation details | H28; menu; `.utc-*` |
| live-exit-center | ✓ | `/hrms/exit`, `/hrms/fnf` | start notice, withdraw (API) | H37, C4; tab role |
| live-face-punch-logs | ✓ | `/hrms/attendance?tab=face` | real face events (DB) | headings |
| live-leave-calendar | ✓ | `/hrms/leave` | who's away (API) | headings |
| live-mobile-layout | ✓ | 5 pages at phone width | no horizontal scroll | layout probes |
| live-modules | ✓ | `/modules` | launcher | alert role; "Try again"; `toHaveCSS('opacity','1')` |
| live-navigation | ✓ | `/dashboard` | shell stays mounted, fast switch | `nav[aria-label="Primary"]` |
| live-new-admin-browser | ✓ | `/hrms/learning`, `/dashboard` | admin flows | "Choose date"; views |
| live-onboarding | ✓ | `/hrms/onboarding/instances/new` | start onboarding (API + DB) | "Choose date"; `.utc-trigger` (17 CSS selectors) |
| live-performance-scope | ✓ | `/hrms/performance` | manager sees only the team (DB) | minimal |
| live-rail-highlight | ✓ | 14 pages × 6 roles | rail highlight rule | `nav[aria-label="Primary"]`, `ds-hdr-active`, header gear, phone drawer |
| live-settings-restored | ✓ | `/settings/*`, `/profile`, `/users`, `/audit-logs`, `/roles` × 6 roles | settings exactly as before commit `5f45946` | rail, **header gear**, **profile menu** (`.z-dropdown .w-56`), phone drawer |
| live-staff-dashboard | ✓ | `/dashboard` (staff) | staff dashboard | role=dialog; headings |
| live-w3-access | ✓ | `/hrms/employees`, onboarding new | Access step when adding a person (DB) | **Master classes**; `.toast`; `.utc-trigger` |
| live-w3-analytics | ✓ | analytics, attendance, reports | month picker, previous-year day (DB) | "Choose month"/"Choose date"; headings (11) |
| live-w3-calendar | ✓ | `/dashboard`, `/hrms/attendance`, `/audit-logs` | calendar views, keyboard, phone sheet | `.utc-*` classes; dialog names |
| live-w3-dashboard | ✓ | `/dashboard` | past-date cards match DB | computed style |
| live-w3-faceenroll | ✓ | `/profile`, `/hrms/employees/:id` | enrolment with fake camera (API + DB) | H20 (9 dialog checks); alert role |
| live-w3-greeting-myatt | ✓ | attendance, modules, dashboard, team, me | greeting rule; no My Attendance for owner/admin | tab/tablist roles |
| live-w3-milestones | ✓ | `/dashboard`, `/hrms/employees` | milestone ranges (API) | PO4 menu; "choose date" |
| live-w3-punch | ✓ | attendance, employee | assisted punch (API + DB) | minimal |
| live-w3-r1 | ✓ | employees, Master, onboarding, hiring, profile | calendar on every date field in panels | 14 dialog names; "Close panel"; `.ut-card` + "Edit Employee" (X1); Master `.pop .opt`, `.modal[role=dialog]`; Escape layering |
| live-w3-r2 | ✓ | leave, WFH, shift change, me, muster, manual entry, exit | calendar on those screens (API) | **native confirm (N12)**; `div.ut-card` + `h3` "Add Holiday" (X2); `.ut-card-sm`; H37/H38 names |
| live-w3-r3 | ✓ | documents, compliance, learning, inspector, profile | calendar (API) | H21–H23, H25–H26 names; `.ut-card` (28 CSS selectors) |
| live-w3-r4 | ✓ | reports, performance, expenses, users, profile, dashboard, audit | calendar | H24, H40, H58, H60 names; `.ut-row-hover`, `.utc-*` |
| live-w3-search | ✓ | dashboard, me, employees, documents, leave, payslips, payroll | global search per role (API) | "Advanced search", "Search"; `data-testid="top-search-results"` |
| performance-admin-live | ✓ | `/hrms/performance` | cycles, KPIs (DB) | `getByRole('dialog')` ×12; "Close panel"; Performance views |
| capture-app, capture-design-screens, capture-prototype, company-admin-preview | | many | screenshots only (no checks) | `capture-prototype` cannot read the new handoff (foundation) |
| letters-admin-live | | `/hrms/letters/generated` | generate letter (DB) | H48 dialog |
| live-admin-actions | | `/dashboard` | admin actions | H5/H14 "Change shift" |
| live-advance-admin | | `/hrms/advances` | recovery actions | "Close panel"; C2 |
| live-assets-browser | | onboarding assets, compliance | assets flow (DB) | H50–H52 dialogs |
| live-att-analytics-calendar | | `/hrms/att-analytics` | month calendar vs API | tab role; `.ut-card`; `.recharts-line`; `data-testid` |
| live-browser | | several | smoke | minimal |
| live-candidate-conversion | | `/hrms/hiring` | convert candidate (DB) | C7 |
| live-directory-export | | `/hrms/employees` | CSV export | `.toast` (Master) |
| live-fnf-admin | | `/hrms/fnf` | settlement actions | H43 "Settlement details"; "Close panel"; "Try again"; alert role |
| live-fnf-tabs | | `/hrms/fnf`, `/hrms/exit` | tabs and counts vs API | H39 |
| live-inspector-browser | | `/hrms/compliance` | inspector link | **native confirm (N10)**; alert role |
| live-late-drilldown | | `/dashboard` | late tile → who | role=dialog |
| live-money-modals | | `/hrms/expenses`, `/hrms/advances` | reject claim/advance with reasons (DB); **no native dialogs** | H16, H42 names; `.ut-card`; tab role |
| live-notices-browser | | `/dashboard` | notices | M1, C3 |
| live-offers-browser | | `/hrms/hiring` | offers | views |
| live-overtime-browser | | `/hrms/shifts` | overtime | "Choose month"; tab roles |
| live-payroll-access | | runs, bank, roles, users | payroll access per role (DB) | role=dialog; tab/switch/alert roles; "Try again" |
| live-shift-request-dates | | `/me/shift-change`, `/hrms/shifts` | request takes effect on the chosen date (DB) | "Choose date"; `.utc-*`; tab role |
| live-shift-requests | | `/hrms/shifts` | approve shift requests | tab roles (6) |
| live-time-browser | | `/hrms/ess` | time entries | "Choose date" |

### 7.5 Markup contracts the tests rely on (all phases)

- `role="dialog"` + accessible names (§8.2); "Close panel".
- `role="tab"` (21 files, foundation §14) and `role="tablist"`.
- **View groups**: `role="group"` with `aria-label="<X> views"` from `ModuleKit.Views` (`design/dc/SubTabs.view.tsx:10`): Performance (7 uses), Learning (5), Compliance (4), Expense (3), Role, Leave, Hiring (2 each), Settlement, Onboarding, Incentive, Document (1 each). The new pill tabs must keep these labels and the button names.
- `role="switch"`, `role="alert"`, `role="menu"` / `menuitemradio`, listbox/option/combobox.
- Page headings (read by 30+ scripts, e.g. 11 in live-w3-analytics).
- "Try again" (live-fnf-admin, live-modules, live-payroll-access) — the design says "Retry".
- Classes: `.ut-card` / `.ut-card-sm` (6 scripts), Master classes (4), `.toast` (3), calendar `.utc-*` (10), `.recharts-line`, `.ut-row-hover`, shell `ds-hdr-*`, `nav[aria-label="Primary"]`.
- `data-testid`: `top-search-results`, `advanced-search`, analytics calendar.
- Computed style: `live-modules` (opacity), `live-rail-highlight`, `live-settings-restored`, `live-w3-milestones`, `live-w3-dashboard`, `live-design-hrconfig`.

### 7.6 Baseline

The newest gate results on disk (`_results/final-3`, 26 Sep 15:31) show `live-design-settings` (4 failures: "On this page lists six sections", settings/notifications sections, security coming-soon text, a timeout) and `live-dead-entrypoints` (4: `/me/salary` structure, a DOM-nesting warning, a timeout). `final-2` also had failures in `live-company-restore`, `live-design-hrsetup`, `live-design-payroll`, `live-design-reports`, `live-leave-calendar`. Main moved after that (for example `d7c92e80` fixed settings section scrolling). **Run the 55 on `e32a4dc6` once, before the first redesign merge, and record the result**, so pre-existing failures are not blamed on the redesign.

---

## 8. Tests at risk

### 8.1 From Phase 7 (pop-ups)

| Change | Scripts | What to do |
|---|---|---|
| `window.confirm` → Dialog | live-design-documents (N1), live-design-learning (N3), live-inspector-browser (N10), live-w3-r2 (N12, twice incl. cleanup) | click the Dialog's confirm button; keep the behaviour checks |
| No native dialogs | live-money-modals | keep as is (it must still pass) |
| Hand-rolled drawers replaced | live-w3-r1:183 (X1 via `.ut-card` + "Edit Employee"), live-w3-r2:189 (X2 via `div.ut-card` + `h3` "Add Holiday") | locate by `getByRole('dialog', { name })` |
| Master overlays | live-design-master, live-w3-access, live-w3-r1, live-company-restore; `.toast` in live-directory-export | keep the classes (restyle via CSS) or update selectors |
| Close label | 5 scripts use "Close panel" | keep the label |
| Titles | §8.2 | keep titles, or update tests with the copy change |
| Extra `role="dialog"` | 24 scripts with unnamed `getByRole('dialog')` (58 calls) | exactly one dialog element per pop-up |

### 8.2 Dialog names used by tests

"Choose date" (16 scripts), "Choose month" (4), "Choose dashboard date" (2), "choose date" regex (live-w3-milestones), "Advanced search", "Search" (live-w3-search), "Settlement details" (live-fnf-admin), "Reject claim", "Reject advance" (live-money-modals), "Add a document", "Edit “{title}”", "Add compliance obligation", "Schedule statutory filing", "Register POSH complaint" (live-w3-r3), "Create review cycle", "Create company KPI", "Build reimbursement batch", "Projects & Productivity" (live-w3-r4), "Start notice period", "/Separation details/" (live-w3-r2), and in live-w3-r1: "Add employee", "Add company", "Add staffing agency", "Publish a policy", "Edit employee", "Confirm Probation", "Change employee shift", "Add Experience", "Add Dependent", "Salary structure", "Edit separation details", "Hire details", "Schedule an interview".

### 8.3 Behaviour that changes by design (not only markup)

- **live-settings-restored** compares every role's rail, header gear, profile menu and phone drawer with commit `5f45946` and asserts they are "as before". DECISIONS item 11 removes the header gear and the profile menu and adds More → Settings. This script must be rewritten to the new rule; say so in the final report.
- **live-rail-highlight** reads the gear's `ds-hdr-active` class and the phone drawer; same decision applies.
- Toast position moves from top-right (sonner, 49 files) to bottom centre.

---

## 9. Backend conventions for builders

### 9.1 Where code goes

- **Controllers:** `backend/app/hrms-api/src/main/java/com/hrms/api/<area>/` (95 controllers; for example `attendance/AssistedPunchController.java`). Entities, repositories and core services live in `backend/modules/<module>/` and `backend/platform/<module>/`.
- **Paths:** `/v1/...`; the servlet context is `/api` (`application.yml:118`); the web app calls `apiJson('/v1/...')` (`core/api/client.ts`, base `/api`).
- **Good templates:** the last complete feature, `fa5c37d9` "Assisted face punch" (controller, service, JDBC recorder, scope, test, migration V143_40); `V143_22__master_data_org.sql` for column additions; `V143_33__wave2_permission_levels_and_admin.sql` for permissions.

### 9.2 Adding an endpoint

```java
@RestController
@RequestMapping("/v1/<area>")
@Tag(name = "…", description = "…")
@SecurityRequirement(name = "bearerAuth")
public class XController {
    private final XService service;
    public XController(XService service) { this.service = service; }

    @Operation(summary = "…")
    @GetMapping("/things")
    @PreAuthorize("hasAuthority('<code>')")          // or "@perm.check('<code>')"
    public ResponseEntity<XService.ListDto> list(@RequestParam(required = false) String q,
                                                 @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(service.list(jwt, q));
    }
}
```

- **Two guard styles:** `hasAuthority('code')` reads the token's `permissions` claim (`CanonicalProdSecurityConfig.jwtAuthenticationConverter`), so a new grant applies after the next token refresh or sign-in. `@perm.check('code')` / `@perm.hasAny(…)` (`platform-rbac/.../PermissionChecker.java`) reads roles + the employee baseline + per-person overrides from the database with a 60 s cache; approvals and money actions use it. Use `hasAnyAuthority(...)` for "either"; `isAuthenticated()` for personal endpoints (`/v1/me/...`).
- **Who is calling:** tenant from `jwt.getClaim("tenant_id")` or `TenantContext.getTenantId()`; login id `jwt.getSubject()` / `TenantContext.getUserId()`; employee `jwt.getClaimAsString("employee_id")`.
- **Team scope:** `TeamEmployeeScope.teamOf/resolve` (departments the person heads, else direct reports; admins see the company) and `ApproverScopeGuard.assertCanDecideFor(...)` for every decide endpoint (added 24 Sep after managers could decide anyone's requests). Keep the self-approval guards in services.
- **Errors:** `BusinessRuleException(message, CODE)` → 422; `ResourceNotFoundException` → 404; `AccessDeniedException` → 403; `HrmsException(message, status, CODE)` for anything else. Body: `{ timestamp, status, errorCode, message }` (`ErrorResponse`). Messages are the plain-English text the UI shows ("Choose punch in or punch out."), and codes are UPPER_SNAKE.
- **Frontend side:** a hook in `modules/hrms/api/use<Area>.ts` with `useQuery({ queryKey: ['hrms', '<area>', …], queryFn: () => apiJson<T>('/v1/…') })` / `useMutation` + `qc.invalidateQueries`; `HttpError` exposes `status` and `payload` for branching.

### 9.3 Adding a permission

1. In the migration: `INSERT INTO rbac.permissions (code, display_name, module, description) VALUES (…) ON CONFLICT (code) DO NOTHING;` with a plain-English name and description (they appear on Roles & permissions as written). The `module` value picks the group (labels in `modules/rbac/components/AccessPicker.tsx:23`; add a label there for a new module).
2. Risk level, guarded like V143_33/V143_40: `UPDATE rbac.permissions SET risk_level = 'MEDIUM' WHERE code IN (…) AND risk_level = 'LOW'` inside `IF EXISTS (… column risk_level …)`.
3. Grants to system roles (`tenant_id IS NULL`): **always `OWNER` and `SUPER_ADMIN`**, plus the roles that should have it by default (`ADMIN`, `HR_MANAGER`, `DEPT_MANAGER`, `MANAGER`, `FINANCE_LEAD`, …): `INSERT INTO rbac.role_permissions (role_id, permission_code) SELECT r.id, '<code>' FROM rbac.roles r WHERE r.tenant_id IS NULL AND r.code IN (…) ON CONFLICT DO NOTHING;`. `OwnerPermissionInvariantCheck` stops the app at boot if OWNER lacks any non-`platform` permission.
4. **Self-service permissions** go to the `EMPLOYEE` role: every person with an employee record inherits that role's grants as a baseline (`EmployeeBaselinePermissions`, 5-minute cache), whatever their other roles.
5. Add the constant to `packages/sdk/src/permissions/codes.ts` (`P.*`; "backend-seeded codes MUST have a constant here").
6. The UI reads permissions from `/v1/canonical-auth/me` (`authStore`), gates with `usePermission` / `useAnyPermission` / `PermissionGate` / `RouteGuard` / `RequirePermission`, and menus through `shared/navigation/pageRegistry.ts` (`MENU_RULES`, `menuRule`) + `access.ts`.

### 9.4 Migrations

- **Folder:** `backend/app/hrms-app/src/main/resources/db/canonical/` (profile `canonical`; `db/dev-seed/V900–V904` hold demo data and never load in production; `db/migration/` is the legacy v1 set).
- **Naming:** `V143_<n>__snake_case_description.sql` (Flyway version 143.n). Latest: **V143_40__assisted_face_punch.sql** (26 Sep), applied in the recovery DB. Never used: 143.29, 143.35–143.39. The rules say each builder uses only the number the lead reserves for it.
- **Header comment:** what and why, "Read and written with JDBC only (no JPA entity maps it)", "Numbered 143.n so it cannot collide…", "Idempotent", "Production has Flyway OFF: apply by hand, as a superuser (row-level security)".
- **Idempotent:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_policies …) … $$`.
- **New tenant table:** `tenant_id UUID NOT NULL`; indexes lead with `tenant_id`; `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` and a policy `USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())`; `COMMENT ON TABLE`; grants to the runtime role inside `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app')`: `GRANT USAGE ON SCHEMA …; GRANT SELECT, INSERT, UPDATE, DELETE ON … TO ut_app;`.
- **Flyway config:** local canonical profile has `out-of-order: true`, `validate-on-migrate: false`, history table `flyway_schema_history_canonical`; `canonical-prod` loads only `db/canonical` and uses `ddl-auto: validate`.
- A second precedent exists: `SeatOverageSchemaBootstrap` / `ShiftChangeRequestSchemaBootstrap` create JDBC-only tables at startup with `CREATE TABLE IF NOT EXISTS`, swallowing errors. It conflicts with "migrations by hand"; don't use it without the lead's approval.

### 9.5 JdbcTemplate vs JPA

- Production runs `ddl-auto: validate`: every column a JPA `@Entity` maps must exist, or production refuses to start. **Rule for this redesign (DECISIONS 2): no change to any `@Entity` mapping; new tables and columns are read and written with `JdbcTemplate` only.** A new column on a table JPA maps is safe for `validate` only if the entity does not map it and it is nullable or has a default (JPA inserts ignore it).
- Tables mapped by JPA today (do not add mapped fields): `advance_mgmt.advance_requests`; `attendance.employee_shift_assignments, event_logs, records, regularization_requests, shift_policies`; `audit.events`; `auth.invitation_tokens, otp_requests, refresh_tokens, user_credentials`; `compliance_mgmt.compliance_items, inspector_sessions, posh_complaints, statutory_filings`; `document_mgmt.employee_documents`; `expense_mgmt.expense_claims, expense_items, expense_policies`; `fnf_mgmt.fnf_components, fnf_settlements`; `hiring_mgmt.candidates, job_requisitions, offers`; `hrms.classification_rules, contractors, departments, designations, emergency_contacts, employee_addresses, employee_bank_accounts, employee_dependents, employee_documents, employee_education, employee_experiences, employee_identities, employees, onboarding_assets, onboarding_instance_tasks, onboarding_instances, onboarding_tasks, onboarding_templates`; `integration_mgmt.integration_connections`; `learning_mgmt.employee_skills, training_enrollments, training_programs`; `leave_mgmt.holiday_calendars, leave_balances, leave_requests, leave_types, wfh_requests`; `letters.distribution_jobs, distribution_recipients, generated, templates`; `notif.device_tokens, notifications`; `notiftemplate_mgmt.notification_templates`; `org.branches, companies, employment_types, grades, shifts`; `performance_mgmt.goals, performance_reviews, review_cycles`; `pli_mgmt.pli_awards, pli_targets`; `policy_mgmt.hr_policies, policy_acknowledgements`; `public.geo_fence_audits, geo_fence_zones`; `rbac.permissions, role_permissions, roles, user_roles`; `settings.holiday_calendar, hr_configuration`.
- **JDBC writes run inside `@Transactional`** (see `AssistedPunchRecorder`): the data source forces `autoCommit=false` to hold `SET LOCAL app.tenant_id`, so a write outside a transaction boundary is not what you want.
- **Every SQL statement filters `tenant_id = ?`** as well, even though RLS already scopes it (belt and braces, and it keeps index use).
- **Concurrency:** `SELECT pg_advisory_xact_lock(hashtextextended(?,0))` per entity (assisted punch) when two people may act at once.

### 9.6 Tenant scoping and RLS

`TenantContextFilter` puts the token's tenant and user into `TenantContext`; `TenantAwareDataSource` runs `SET LOCAL app.tenant_id = '<uuid>'` on every leased connection (PgBouncer-safe); policies use `current_tenant_id()`; no tenant → no rows (fail closed). `rbac.roles` rows with `tenant_id IS NULL` are system roles; custom roles carry the tenant.

### 9.7 Audit logging

`com.unifiedtree.audit.AuditService.record(module, action, entityType, entityId, summary)` writes `audit.events` in a new transaction (a rolled-back action is still audited); actor and tenant come from `TenantContext`. Wrap the call in try/catch and log a warning (as `AssistedPunchService.audit` does). Actions are UPPER_SNAKE (`ASSISTED_PUNCH_IN`); the summary is a plain sentence. The audit log page reads them (`/audit-logs`, `audit.read`).

### 9.8 Graceful degradation (no standard exists yet)

Nothing today turns "migration not applied" into a clean response: a missing table surfaces as a 500. Only `faceEnroll.ts:191` special-cases a 404. Proposal for the lead (question 6): new JDBC services catch Spring's `BadSqlGrammarException` (SQL states `42P01` undefined table, `42703` undefined column) and throw `HrmsException("This isn’t switched on yet.", SERVICE_UNAVAILABLE, "FEATURE_NOT_READY")`; the web app shows that block's empty or "not available yet" state when `HttpError.status === 503 && payload.errorCode === 'FEATURE_NOT_READY'`, and hides actions that need it. Existing endpoints keep their old behaviour (new parameters optional).

### 9.9 Backend tests and builds

Unit tests next to the code (`app/hrms-api/src/test/java/com/hrms/api/<area>/`; e.g. `AssistedPunchScopeTest`, 312 lines, plain JUnit + Mockito). Build and test through `_tools/heavy.sh` with JDK 21: `mvn -q -o -pl app/hrms-app -am package -DskipTests`, then `mvn -q -o -pl app/hrms-app -am test -Dtest='…' -Dsurefire.failIfNoSpecifiedTests=false -DfailIfNoTests=false`. Run the tests of every module you touched.

---

## 10. Copy style

- **No i18n framework** (no i18next, react-intl, formatjs, lingui). Copy is inline English.
- **Tone:** short, plain, sentence case, no jargon (RULES.md). Some older titles are Title Case ("Edit Work Details", "Add Holiday", "Confirm Probation", "Invite Workspace User", "New Distribution").
- **Typography:** curly apostrophes and quotes (’ “ ”: 623 uses), en dash for ranges, "·" as a separator.
- **Confirm pattern:** title = a question naming the object in curly quotes ("Delete “{name}”?"); body = what happens and whether it can be undone ("This can’t be undone." / "You can restore it from …"); button = the verb ("Delete", "Archive", "Withdraw notice"); cancel = "Cancel" or "Keep it"; `tone: 'danger'` for destructive ones.
- **Toasts:** past-tense statements ("Filing recorded", "Holiday added", "Document deleted"); errors "Couldn’t …" (197) more often than "Could not …" (84), with the server's message as detail.
- **Errors in blocks:** "Retry" (257) and "Try again" (66; three tests match it). The design says "Retry".
- **Numbers and dates:** Indian formats (`en-IN`, ₹, lakh grouping; 75 places), business day in IST (`istToday`, `dates.ts`, 119 places), dates like "26 Sep 2026" (`ModuleKit.dmy`).

---

## 11. Icons

- **`design/dc/icons.tsx` (`dashIcon(name, size)`, `dashIconComponent`, `dashTileIcon`)**: 77 lucide paths: alertTriangle, calculator, banknote, workflow, filePen, users, userCheck, userMinus, userX, userPlus, alert, help, bulb, home, download, plus, clock, briefcase, shield, rupee, inbox, calendarClock, calendarPlus, calendarDays, calendar, cake, award, megaphone, arrowRight, activity, chart, building, fileText, star, clipboard, circleX, armchair, dashboard, grid, database, creditCard, receipt, target, logOut, settings, search, bell, chevronDown, chevronLeft, chevronRight, menu, x, swap, checkCircle, mapPin, hash, globe, list, pencil, archive, lock, crosshair, trendingUp, sun, moon, sunrise, sunset, timer, scanFace, fingerprint, smartphone, pieChart, calendarCheck, trash, check, info, coffee. **An unknown name silently renders the `alert` icon.** Used in 60 files.
- **`lucide-react` 0.436.0** (101 files). Every icon the design needs exists there, including the ones `dashIcon` lacks: `AlarmClock`, `SlidersHorizontal`, `DollarSign`, `Package`, `ShoppingCart`, `CircleMinus`, `Hourglass`, `Percent`, `Wallet`, `Landmark`, `Layers`, `Kanban` / `SquareKanban`, `ChartColumn`, `PanelRight`, `Undo2`, `HandCoins`.
- **Master's own `ICONS`** (`MasterDesign.tsx`): 94 kebab-case lucide paths (including wallet, layers, hourglass, percent, landmark, bar-chart-3, minus-circle, id-card, graduation-cap…).
- **Design names → today** (`hrms-core.js`, `hrms-dash.js`): dashboard, home, database, users, userPlus, userCheck, userX, target, logOut, clock, calendar, receipt, building, shield, chart, rupee, briefcase, settings, inbox, checkCircle, timer, mapPin, megaphone, cake, award, star, clipboard, swap, alert, userMinus, help, check, lock match `dashIcon`; calCheck → `calendarCheck`, card → `creditCard`, trending → `trendingUp`, xCircle → `circleX`, file → `fileText`, calClock → `calendarClock`, calPlus → `calendarPlus`, seat → `armchair`, pulse → `activity`, bars → `chart`; **missing:** alarm, sliders, dollar, package, cart, minusCircle, hourglass, percent, wallet, bank, layers, kanban, half (use lucide or add them to `dashIcon`).
- The Tabler Icons webfont loaded in `index.html` is unused.

---

## 12. Gaps (cross-cutting)

| Gap | Backend work | Schema change | JPA-mapped | Size |
|---|---|---|---|---|
| **Approval Undo** (README: approve/reject rows offer Undo; DECISIONS 3 lists it). No undo endpoint exists for any decision (leave, WFH, attendance fix, shift change, expense, advance, overtime, PLI, F&F). | Either (a) client-side delayed send (the decision is sent after the undo window; no backend; risk: a closed tab within the window loses or must flush the decision), or (b) server-side `POST …/{id}/undo-decision` per module that reverts status and side effects (leave balance and ledger, attendance day, shift assignment, expense and advance status), guarded like the decide endpoint + `ApproverScopeGuard`, audited, notifying the requester if they were notified | (a) none; (b) none if status and `decided_at` exist, or a JDBC table of undo tokens | (b) touches JPA tables' **existing** columns only | (a) M · (b) **L** |
| **Reason on inline reject.** WFH rejection needs a reason on the server (`WFH_REJECT_REASON_REQUIRED`), overtime rejection needs a note, status override and "not them" need ≥ 3 characters; expense and advance rejects collect a reason in drawers today | none (a small reason Dialog in `ApprovalRow`) | none | — | S |
| **"Feature not ready" convention** for JDBC features whose migration is not yet applied (§9.8) | a helper in each new service; a shared frontend check | none | — | S |
| **`window.confirm` / `prompt` conversion** (25) | none | none | — | S–M |
| **`ConfirmDialog` concurrent requests** (a second request drops the first promise) | none | none | — | S |
| **One toast system** (5 today) | none | none | — | M |
| **Kit tests** need jsdom + Testing Library (not in the pnpm store) or rely on live scripts | none | none | — | S (+ network, lockfile) |
| **Fresh gate baseline** on `e32a4dc6` and a test-update list per phase | none | none | — | M |

---

## 13. Conflicts with existing behaviour or earlier decisions

1. **Close label:** design "Close"; `HrDrawer` "Close panel" (5 tests). Keep "Close panel" on panels.
2. **Panel accessibility:** the design's panel has no `aria-modal` and no focus trap; ours do. Keep ours.
3. **Toast timing and position:** design 2.6 s bottom centre; today sonner top-right (49 files) and kit toasts 3.2 s with errors 6–8 s. Use the design for success; keep errors longer (foundation §13.19).
4. **One-click reject vs required reasons** (§12): the inline Reject must still ask for a reason where the server or today's flow requires one.
5. **Settings stay in their own sections:** `SettingsPage` keeps its unsaved-changes bar and `beforeunload`; Phase 7 only restyles `SettingsLeaveModal`/the PaySettings leave modal, never moves settings into panels.
6. **Shared calendar:** every date field in every panel stays on `shared/components/calendar`; the SidePanel must not break its focus and Escape model (§5.4).
7. **Companies:** M2 carries the Inactive/restore flow and the archive guards ("Can’t archive yet" with only OK). The new Dialog needs that one-button blocked variant; Phase 5's stepper panel replaces H3/H4.
8. **My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN:** H2 ("Ask for a fix") and H13 live on self-service views that the rule already hides; nothing in Phase 7 changes that.
9. **Rail highlight (`railLit.ts`):** pop-ups don't change the route; links inside panels count as "a link on the page" under the rule. No conflict.
10. **Settings entry (DECISIONS 11)** changes what live-settings-restored and live-rail-highlight assert (§8.3).
11. **Motion quirk:** `pop()` has no `right` case, so the prototype's right panel animates like a dropdown. Suggest mirroring `left` (`translateX(18px)`).
12. **Heavy weights in overlays:** `HrDrawer` title 700, Master titles 800, ModuleKit toast 700; the design allows 400–600 only (129 `font-bold*` classes, 453 inline 700–900 weights, 49 CSS rules app-wide; foundation owns the global clamp).
13. **Old emerald `#059669`** in ConfirmDialog, ActionModal, the calendar (222 uses app-wide); brand is `#0F6E56`.

---

## 14. Shared components needed

From the README list: **SidePanel** (plain, and stepper with done/current/todo, sticky footer, disabled Next with a reason tooltip, `busy`, widths), **Dialog** (plain, confirm with danger tone, blocked one-button variant, form variant with a required field), **Popover / Menu** (`role="menu"`, `menuitemradio`, Escape, outside press, flip), **Dropdown with search** (company picker), **Toast** (one engine), **FormField** (text, select, textarea, toggle, slider; date through the shared calendar), **Skeleton / EmptyState / error with Retry** inside detail panels, **ApprovalRow** (Undo, reason Dialog), **SegmentedControl**, **Ring** (geofence preview in the branch panel), **StatusPill**, **Avatar**.

Page-specific pieces: the payslip body (H12), settlement components (H43), KPI history (H61), the letter preview (H48), the face camera (H20), the distribution recipient filter (X4), bank UTR capture (M6 / P2).

---

## 15. Risks

1. **Pre-existing test failures** blamed on the redesign unless a baseline is recorded first (§7.6).
2. **Hand edits to generated views** are lost when `design-build.mjs` runs; restyle through `HrDrawer`/`Overlay.tsx` instead.
3. **Stacking regressions:** a Dialog below a SidePanel, or a portalled popover below a panel, makes controls unreachable; keep the order in §3 and test nested cases (Advance details → Reject advance; InlineCreate over the legacy form; calendar inside every panel).
4. **`backdrop-filter` containing-block trap** (§5.8).
5. **Radix centring** regression if the Modal restyle moves the transform into classes (the invite modal hung off-screen before).
6. **Strict-mode test failures** if a kit wrapper adds a second `role="dialog"`.
7. **Dark mode:** every overlay hard-codes light colours (`bg-white`, `#fff`, slate/gray shades, `#059669`). A dark pass must include every panel and dialog listed here.
8. **Native confirm removal** changes the test flow in 4 scripts; forgetting the cleanup path in live-w3-r2 leaves a holiday behind in the long-lived recovery DB.
9. **The synchronous navigation guard (N11)** cannot simply become an async Dialog; a naive conversion lets the navigation happen before the answer.
10. **Master DOM** is generated; patches go through `master-patches.mjs`; editing `MasterDesign.tsx` directly is overwritten by the next `master-build.mjs` run.
11. **New permissions** don't reach `hasAuthority` checks until a token refresh; live tests must sign in again after granting.
12. **Production migrations by hand:** any code path that assumes a new table exists will 500 until it is applied (§9.8).

---

## 16. Open questions (real ones only)

1. **N11 (legacy employee form's navigation guard)** is a synchronous `window.confirm` inside a capture-phase click handler. Keep it native (safest, it works), or rebuild it as "always block, ask with the kit Dialog, then navigate"?
2. **Approval Undo:** client-side delayed send (no backend, small risk of a lost decision if the tab closes) or server-side undo endpoints per module (L)? And the window length (the design's toast is 2.6 s)?
3. **Title case → sentence case in pop-up titles** ("Confirm Probation" → "Confirm probation", "Add Holiday" → "Add holiday", …): change them with the matching test updates, or keep today's titles?
4. **Dead pop-ups** (§4.9): leave them untouched (the prompt forbids removals without approval), or remove them in this redesign?
5. **Kit component tests:** add jsdom + Testing Library (needs a network install and a lockfile change), or cover the kit only with live Playwright scripts?
6. **"Feature not ready" (503 `FEATURE_NOT_READY`) convention** for JDBC-only features until their migration is applied (§9.8): adopt it for all builders?
7. **Migration numbers** for the redesign's backend work: which block (143.41 onward, or 144.x) does the lead reserve per builder?
