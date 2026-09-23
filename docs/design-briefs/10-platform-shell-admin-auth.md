# Platform shell, admin & auth — page briefs

This group is the chrome every HRMS screen lives inside (rail, header, ⌘K search, notification bell, profile menu), the workspace-level **Settings** app (Users & Access, Roles & Permissions, Audit Logs, Configuration tabs, Manage Plan, App Launcher) and the unauthenticated auth surfaces (Login, Accept Invite, Forgot/Reset Password, Pending Approval, No Access) plus the placeholder screens (ComingSoon, ModuleComingSoon, ModuleNotActivated).
Sidebar: when the URL is `/users`, `/roles`, `/audit-logs` or `/settings*` (the `PLATFORM_ITEMS` paths) the shell switches to the **Settings** scope and the rail shows `SETTINGS_NAV` (Profile · Branding · Security · Notifications · Billing & Plan · Integrations · Users & Access · Roles & Permissions · Audit Logs · Danger Zone). `/profile` is **not** in that list, so the Settings rail's own "Profile" leaf drops the user back into HRMS scope. `/modules` is the launcher scope (transparent header, no rail). Everything else (including `/profile` and `/plan`) is HRMS scope.
Roles (from `layouts/PlatformShell.tsx`): `ROLE_PRIORITY` = SUPER_ADMIN › OWNER › COMPANY_ADMIN › ADMIN › HR_MANAGER › FINANCE_LEAD › DEPT_MANAGER › MANAGER › EMPLOYEE. Bundles: **R_HR** = OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER · **R_ADMIN** = R_HR + FINANCE_LEAD · **R_ADMIN_MGR** = R_ADMIN + DEPT_MANAGER · **R_FIN_RUPEE** = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, FINANCE_LEAD · **R_FIN_META** = R_FIN_RUPEE + HR_MANAGER · **R_ESS** = EMPLOYEE. `isAdmin` (shell, `useRoles.ADMIN_ROLES`) = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN or the `*` permission. `isVisible()` treats ADMIN as COMPANY_ADMIN and MANAGER as DEPT_MANAGER.

---

## Platform shell (rail · header · ⌘K search · notifications · profile menu)  `wraps every authenticated route`
- **File:** `layouts/PlatformShell.tsx` (+ `shared/components/GlobalSearch.tsx`, `shared/search/actionRegistry.ts`, `shared/search/rank.ts`, `shared/search/useEmployeeSearch.ts`, `core/notifications/notificationStore.ts`)  ·  **Sidebar:** is the sidebar  ·  **Roles:** every authenticated user; every item is filtered by `visibleForRoles` / `visibleWithAnyPermission`.
- **Status:** LIVE — nav is static config (`NAV_ITEMS`, `MODULE_ITEMS`, `PLATFORM_ITEMS`, `SETTINGS_NAV`) filtered by the JWT roles/permissions; bell reads `GET /v1/notifications*`; ⌘K people search calls `GET /v1/search?q=`.

### Purpose
The frame the user never leaves: pick a section on the dark rail, pick a sub-page in the header tab row, jump anywhere with ⌘K, see unread notifications, switch apps, open Settings, sign out. Admins, HR, finance, managers and employees all use the same shell with different rail contents.

### Layout (map to the design-system parts)
1. **Desktop rail** (`<aside class="workspace-rail">`, dark ground `RAIL_BG` linear-gradient #090D16 → #0C1525 → #052E22, hidden below `md`): brand tile `ut•` + "UnifiedTree" (NavLink → `/dashboard`); one `workspace-rail-link` per `railItems` entry — lucide icon (18) over a one-word label from `RAIL_LABELS` (Dashboard · Me · Team · Company · Master · Time · Leave · Hire · Payroll · Expense · Perform · Comply · Reports · Exit · HR Setup; Settings scope: Profile · Brand · Security · Alerts · Billing · Connect · Users · Roles · Audit · Danger); active = `is-active` (white-tint block). Pinned at the bottom in non-admin scope for admins: "Company settings" → `/settings`.
2. **Header** (`workspace-header`, 60px, `HEADER_BG` gradient #090D16 → #0B192C → #0F6E56, white text): hamburger (mobile) · tenant name (`tenantName || 'My company'`, lg+) · **search pill** "Search employees, leaves, reports, settings..." with `⌘ K` kbd (sm+; icon-only button on mobile) · right cluster: Settings icon → `/settings`, LayoutGrid icon → `/modules`, `ShellNotificationBell`, avatar block (initials circle #059669 + `fullName` + `roleBadgeText` e.g. "HR Manager +1"; fallback "Employee") → profile popover.
3. **Module tab row** (`workspace-module-nav`, rendered whenever the active rail group has ≥1 visible child — the `subTabs` "≥2 distinct paths" filter at `PlatformShell.tsx:527` is computed but never rendered, so single-leaf groups such as Company Profile, Leave Management and Expense Management show a one-tab row): one `workspace-module-link` `NavLink` per child (e.g. Attendance Analytics · Daily Tracking · Shifts & Overtime · Geofencing). Children sharing a path are deduped by a `Map` keyed on path (safety net — no HRMS group currently has two children on one path; Resignation & Exit → `/hrms/exit` and Full & Final Settlement → `/hrms/fnf` are separate routes).
4. **Content** `<div id="workspace-content">` → `<Outlet />`; skip-link "Skip to workspace".
5. **Mobile drawer** (272px, `md:hidden`, framer slide-in): `WorkspaceMark` (LayoutGrid tile + tenant name → `/modules`) + `AppSwitcher`; app label chip (HRMS / Settings / app); flat links (`renderFlat`) then collapsible groups (`renderGroup`, chevron, child dots); bottom profile chip (initials tile, name, role badge) → `profileMenu`.
6. **⌘K palette** (`searchModal`, fixed overlay, `ut-card ut-card-lg max-w-2xl`, 12vh from top): `GlobalSearch` — search row (emerald icon tile, autofocus input, `ESC` kbd or ✕ clear), result list grouped **Quick actions → Pages → People** with a `↵` kbd on the highlighted row.
7. **Notification popover** (w 24rem, right-aligned): header "Notifications" + `{unreadCount} new` pill + "Mark all read"; list capped at 8 rows (tone tile, title, message 2-line clamp, `formatDistanceToNow` uppercase stamp; unread rows tinted #ECFDF5).
8. **Profile popover** (w 56): name + email header; My Profile · My Apps · Settings (admins only); Sign out (danger).
9. **App switcher popover** (mobile drawer only, w 300): "Apps" + "Browse all"; 3-col grid of HRMS + non-HRMS modules (lock badge when not owned) + Settings tile for admins.
10. **Launcher mode** (`/modules`): no rail; transparent absolute header with only the avatar/profile popover on the right.

### Data shown
- Nav model: static arrays in `PlatformShell.tsx`; `activeModules` from `useLocalAuthStore.tenant.activeModules`; roles/permissions from `@unifiedtree/sdk` `useAuthStore`.
- Identity: `useDisplayName()` → `fullName`, `initials`; `tenant.name`, `tenant.slug`.
- Bell: `useNotificationStore` → `GET /v1/notifications?page=0&size=50` (lazy, when the popover opens), `GET /v1/notifications/unread-count` (background poll from `NotificationProvider`: on login and every 5 min, paused while the tab is hidden), `PUT /v1/notifications/{id}/read`, `POST /v1/notifications/mark-all-read`, `DELETE /v1/notifications/{id}` (exists in store, no UI). Row fields: `title`, `message`, `type` (info/success/warning/error), `isRead`, `link`, `createdAt`.
- ⌘K pages: `searchPages` derived from the same nav arrays filtered by `isVisible`, keywords from path segments + group; `PLATFORM_ITEMS` are pushed before `SETTINGS_NAV` and deduped by path, so the palette labels `/settings` "Configuration" and `/roles` "Roles & Perms" (the rail says "Roles & Permissions"). Quick actions: `QUICK_ACTIONS` (30 entries, categories People/Time/Leave/Pay/Hiring/Documents/Insights/Admin) filtered by `permissions.has(code)`. People: `useEmployeeSearch` → `GET /v1/search?q=` (min 2 chars, 150ms debounce, `staleTime` 60s, `retry:false`) → `displayName`, `employeeCode`, `departmentName`, `jobTitle`, `profilePhotoUrl`, `truncated`, `limit`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Brand tile `ut•` | rail top | NavLink → `/dashboard` | all | LIVE |
| Rail item (Dashboard … HR Setup / Profile … Danger) | rail | `NavLink to={item.target}` with `title={fullLabel}` tooltip (group → first visible child path); the `renderRailItem` button variant in the file is unused | per `visibleForRoles` | LIVE |
| Company settings | rail bottom (HRMS/app scope) | NavLink → `/settings` | `isAdmin` | LIVE |
| Module sub-tab | header tab row | NavLink → child path | per child roles | LIVE |
| Open menu (hamburger) | header, mobile | opens mobile drawer | all | LIVE |
| Search pill / search icon | header | `setSearchOpen(true)` → ⌘K palette; also `Ctrl/⌘+K` toggles, `Esc` closes | all | LIVE |
| Settings icon | header right | `navigate('/settings')` (no role check on the icon; route itself is guarded) | all (sm+) | LIVE — see Change |
| Workspace modules icon | header right | `navigate('/modules')` | all (sm+) | LIVE |
| Bell | header right | toggles popover; fetches list on open | all | LIVE |
| Mark all read | bell popover (only rendered when `unreadCount > 0`) | `POST /v1/notifications/mark-all-read` | all | LIVE |
| Notification row | bell popover | `PUT /v1/notifications/{id}/read`; if `n.link` → `navigate(link)` | all | LIVE |
| Avatar block | header right | toggles profile popover | all | LIVE |
| My Profile | profile popover | `navigate('/profile')` | all | LIVE |
| My Apps | profile popover | `navigate('/modules')` | all | LIVE |
| Settings | profile popover | `navigate('/settings')` | `isAdmin` | LIVE |
| Sign out | profile popover | `logout()` (SDK) | all | LIVE |
| WorkspaceMark (tenant name) | mobile drawer | `navigate('/modules')` | all | LIVE |
| Switch app (grid icon) | mobile drawer | toggles app-switcher popover | all | LIVE |
| Browse all | app switcher | `navigate('/modules')` | all | LIVE |
| App tile | app switcher | owned → `navigate(home)`; not owned + admin → `window.open(VITE_WEBSITE_URL/edit-workspace?ws=…&email=…&add=…)`; not owned + non-admin → no-op | all | LIVE |
| Group header (e.g. "Attendance & Time") | mobile drawer | expands/collapses children | all | LIVE |
| Group child | mobile drawer | NavLink → child path | per roles | LIVE |
| Profile chip | mobile drawer bottom | toggles `profileMenu` | all | LIVE |
| ⌘K: type query | palette | ranks actions (max 6) + pages (max 8) + people (server) | all | LIVE |
| ⌘K: ↑ ↓ ↵ | palette | move cursor / `onSelect` → `navigate(res.path)` | all | LIVE |
| ⌘K: Clear search ✕ | palette | clears input | all | LIVE |
| ⌘K: result row click | palette | `navigate(path)` (action deep-links e.g. `/hrms/attendance?tab=team&status=LATE`, `/hrms/employees?add=1`; people → `/hrms/employees/{id}`) | per action `permission`/`anyOf` | LIVE |
| Backdrop click | palette / drawer | closes | all | LIVE |

### States
- Bell: `loading && !loaded` → "Loading…"; empty → bell tile + "You're all caught up"; unread dot (#F97316 ringed #059669) only when `unreadCount > 0`.
- ⌘K: idle → "Start typing to jump anywhere" + hint "Try “leave”, “attendance”, “payroll” or a colleague’s name" (or "…or “add employee”" without people permission); no hits → "No pages, actions or people match “{q}”" (+ "Type at least 2 characters to search people." / "Searching for a person? People search needs Workforce directory access."); People group header shows "Searching…"; people error → alert "People search is unavailable right now. Pages and actions still work — try again in a moment."; truncated → "Showing the first {limit} people — keep typing to narrow it down."
- Route guard: `RouteGuard` renders `null` while auth is idle/loading, redirects to `/login` (with `returnUrl`) when unauthenticated, and renders inline **Access Restricted** (🔒 "You do not have the required permissions to view this page. Contact your administrator if you believe this is a mistake.") when `anyOf` fails.
- Empty sidebar is prevented: OWNER/COMPANY_ADMIN are in every admin bundle (comments in file).
- `/helpdesk` was dropped from the sidebar (no route).

### Rules & permissions
- Visibility union across all roles held; `visibleWithAnyPermission` short-circuits (e.g. `hrms.hiring.offer.read` reveals Hiring Pipeline).
- Rupee screens (Payroll Dashboard, Salary Structure, Payroll Settings, Bank Disbursement, Full & Final) use `R_FIN_RUPEE` — HR_MANAGER excluded by client rule.
- ⌘K never offers a page the sidebar hides, never an action the destination would 403, and never fetches an employee list client-side (2026-08-10 incident note in file).
- Bell list is fetched only when opened; background poll only refreshes the count.

### Gaps & plan  (keep / add / change)
- **Keep:** single-source nav (`PlatformShell` is the SSOT — [HANDOFF §3] "Preserve PlatformShell.tsx as the navigation source"); truthful unread dot; ⌘K three result classes (matches [BLUEPRINT §9.2]); rail + header tab row; the exit split is already done — "Resignation & Exit" → `/hrms/exit`, "Full & Final Settlement" → `/hrms/fnf` ([BLUEPRINT §7.2 / §27 P0-9] "Exit route collision — Split"; file comment "Two leaves, two routes"); Roles & Permissions and Audit Logs already surface in `SETTINGS_NAV` ([BLUEPRINT §6 rows 52–53 / §7 "† moved from admin scope into Settings"]).
- **Add:** [BLUEPRINT §9.3 / §24.2] breadcrumbs on every page ≥2 deep. [code: `PlatformShell.tsx` comment in `ShellNotificationBell`] bell footer "links to a fuller view once we have one" — no full notifications page exists (`NotificationPanel.tsx` is imported only by the dead `DashboardLayout.tsx`). [code: `notificationStore.deleteNotification`] delete exists in the store with no UI. [code: `GlobalSearch.tsx` header comment] "Documents and payslips are still not searched here." [BLUEPRINT §9.3] "Recently viewed employees in the palette" — not built.
- **Change:** header Settings icon is shown to every role (only the route guard stops an EMPLOYEE → they land on "Access Restricted"); hide it behind `isAdmin` like the profile-menu item ([BLUEPRINT §7.1 rule 5] "an unauthorised leaf is absent, never a 403 on click"). `roleBadgeText || 'Employee'` fallback mislabels a user with no recognised role. Two different profile menus (mobile chip vs header avatar) render the same `profileMenu` — keep one component. Rail labels are one-word (Perform, Comply, Hire) — [BLUEPRINT §7.1 rule 2 / §27 P0-6 "Truncated labels"] use full labels; tooltips already exist via `title={fullLabel}`. [code: `PlatformShell.tsx` `scope()`] the Settings rail's "Profile" leaf (`/profile`) is outside `PLATFORM_ITEMS`, so clicking it swaps the rail back to HRMS — add `/profile` to the admin-scope match. [code: `PlatformShell.tsx:877`] the header tab row renders for single-child groups (one lone tab) — wire the already-computed `subTabs` (≥2) into the render. [code: `searchPages`] ⌘K page labels for `/settings` and `/roles` come from `PLATFORM_ITEMS` ("Configuration", "Roles & Perms") — align with the `SETTINGS_NAV` labels. `isAdmin` here includes ADMIN (`useRoles.ADMIN_ROLES`) but `Modules.tsx` and `Plan.tsx` keep a local `ADMIN_ROLES` without ADMIN — an ADMIN-only user sees "Company settings" and the Settings tile yet gets the non-admin guard on `/plan`; use the canonical list everywhere.

### Screenshot
`Attach: /dashboard — current shell (rail + header + module tab row), and ⌘K open`

### Claude Design prompt (ready to paste)
```
Design the platform shell for all roles (admin/HR/finance/manager/employee share it). Left: fixed dark-green icon rail (gradient #090D16→#052E22) with brand tile "ut•" and one icon+label per section (Dashboard, Company, Master, Time, Leave, Hire, Payroll, Expense, Perform, Comply, Reports, Exit, HR Setup; "Company settings" pinned bottom for admins) — active item = white-tint block; show full-label tooltips. Top: 60px green header (#090D16→#0F6E56) with tenant name "Ionora Technologies", a search pill "Search employees, leaves, reports, settings…" with ⌘K kbd, Settings icon (admins only), Apps grid icon, bell with orange dot only when unread>0, avatar circle (#059669, initials "AM") + "Admin User / HR Manager +1". Below header: white tab row of the active section's sub-pages, shown only when the section has 2+ sub-pages (Attendance Analytics · Daily Tracking · Shifts & Overtime · Geofencing). Add a breadcrumb line ("HRMS / Attendance & Time / Daily Tracking") on pages 2+ levels deep.
⌘K palette: centred card max-w-2xl; search row with ESC kbd; groups QUICK ACTIONS (↳ tile: "Who is late today", "Apply for Leave", "Run Payroll"), PAGES (# tile: "Daily Tracking — Attendance & Time"), PEOPLE (avatar/initials: "Aarav Menon — EMP-0142 · Engineering · Senior Engineer"); states: idle hint, "No pages, actions or people match “xyz”", "Searching…", error banner, "Showing the first 20 people — keep typing to narrow it down."
Bell popover (w 24rem): "Notifications" + "3 new" pill + "Mark all read"; rows with tone tile, title "Leave request from Priya Nair", message, "12 MINUTES AGO"; unread rows mint #ECFDF5; empty "You're all caught up".
Profile popover: name/email header; My Profile, My Apps, Settings (admin); Sign out in danger colour. Mobile: 272px drawer with grouped nav and bottom profile chip.
```

---

## App Launcher  `/modules`
- **File:** `pages/Modules.tsx` (tiles from `core/api/modulePlans.ts`, `layouts/appConfig.ts`)  ·  **Sidebar:** not in sidebar — reached from `/` redirect after login, header Apps icon, profile menu "My Apps", WorkspaceMark, app-switcher "Browse all"  ·  **Roles:** every authenticated user (`RoleAwareLanding` sends everyone with ≥1 role here); "Manage plan" + locked-tile click only for the page's local `ADMIN_ROLES` = OWNER, SUPER_ADMIN, COMPANY_ADMIN or `*` (note: unlike the shell's canonical `useRoles.ADMIN_ROLES`, this list omits ADMIN).
- **Status:** LIVE — `useModulePlans` → `GET /v1/public/module-plans` merged with `tenant.activeModules`; falls back to built `APPS` if the catalog fails.

### Purpose
Odoo-style post-login landing: the user picks which app to enter (HRMS today; CRM, Accounting, Inventory… as locked/soon tiles). Admins use it to reach the plan configurator and add modules.

### Layout (map to the design-system parts)
1. Full-bleed emerald field (`#16A34A → #059669 → #0D9488 → #047857 → #065F46` linear + three radial glows); the shell's transparent launcher header floats above (avatar/profile popover only).
2. Centred header: greeting pill "Good morning, Suryakumar" (`useDisplayName().greetingName`, on `#04503A/60`), H1 "Choose an app".
3. Search input "Search apps…" (glass style) + **Manage plan →** button (admins, sm+).
4. Error banner (role=alert) "We couldn't load the app catalog." + context line + **Try again** / "Retrying...".
5. Tile grid (3 / 4 / 5 columns): 80px squircle tile with per-app gradient (`TILE_COLORS`, e.g. HR #34D399→#059669, CRM #818CF8→#4F46E5, accounting #FBBF24→#D97706), white lucide glyph (36), label below (13px white). Badges: **Soon** chip (mint `#A7F3D0`, Sparkles) for `LAUNCHING_SOON`; white lock circle for `locked`; locked tiles go grey `#9CA3AF→#6B7280`.
6. Skeleton grid (10 pulsing tiles) while loading with nothing to show.
7. Footer hint for admins when any tile is locked: "Locked apps open the plan configurator — add them any time."

### Data shown
- `useModulePlans()` → `GET /v1/public/module-plans`: `key`, `displayName`, `tagline`/`description`, `icon` (→ `iconMap`), `status` (AVAILABLE / LAUNCHING_SOON / RETIRED — retired filtered out), `includedModules`, `sortOrder` (DB order preserved; HR first).
- Tile status (`planToTile`): `coming-soon` when LAUNCHING_SOON; when AVAILABLE and one of `includedModules` is in `tenant.activeModules` → `active` if a built `APPS` entry exists for it, otherwise `coming-soon`; else `locked`. `home` = the built app's home (HRMS → `/dashboard`). Tile `title` = plan description (tooltip).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Search apps… | header | client filter on label/description | all | LIVE |
| Manage plan → | header (sm+) | `navigate('/plan')` | admins | LIVE |
| Active tile | grid | `navigate(tile.home)` | all | LIVE |
| Locked tile | grid | admin → `navigate('/plan?add={planKey}')`; non-admin → disabled | admins | LIVE |
| Soon tile | grid | disabled (no-op) | — | STUB by design |
| Try again | error banner | `refetch()` | all | LIVE |
| Clear search | empty state | clears query | all | LIVE |
| Avatar → profile popover | shell header | see Platform shell | all | LIVE |

### States
- loading: 10-tile skeleton (`role=status` "Loading apps") only when nothing cached and no active modules.
- empty: "No apps match your search." / "The app catalog is currently unavailable." / "No apps are available for this workspace." (+ Clear search).
- error: alert banner with retry; enabled apps remain usable from the `APPS` fallback.
- no-permission: none (open to all); locked tiles are inert for non-admins with title "Not in your plan".

### Rules & permissions
- Grid shows sellable plans only (no Settings pseudo-tile — client feedback in file). Manage Plan stays in-workspace (client decision 2026-08-07). Launcher icons are colourful by client call (2026-08-11); the emerald stays in the frame.

### Gaps & plan  (keep / add / change)
- **Keep:** DB sort order (HR at top — client flag 2026-08-07), fallback to enabled apps on catalog outage, admin-only locked-tile behaviour.
- **Add:** [HANDOFF §10 G] "desktop/mobile widths … empty/loading/error states" acceptance — the only mobile-width evidence is the five-page 390px check in [STATUS › Important limits still open], which does not name this page.
- **Change:** [code: `Modules.tsx` `hidden … sm:inline-flex`] the "Manage plan" button is hidden below `sm` — admins on phones have no path to `/plan` except a locked tile. [code: locked tile `title`] locked tiles for non-admins give no explanation beyond the "Not in your plan" tooltip; show a one-line "Ask your admin to add this app" caption. [code: local `ADMIN_ROLES`] replace with `useRoles.ADMIN_ROLES` so an ADMIN-only user is treated the same as in the shell.

### Screenshot
`Attach: /modules — current screen`

### Claude Design prompt (ready to paste)
```
Design the App Launcher for all roles on a vivid emerald field (#16A34A top → #065F46 bottom with soft radial glows); the shell header is transparent here showing only the avatar. Centre: mint greeting pill "Good morning, Suryakumar" and H1 "Choose an app" in white; a glass search "Search apps…" and, for admins, a glass button "Manage plan →". Grid 5 columns desktop / 3 mobile of 80px squircle app tiles with white glyphs: HR & Payroll (#34D399→#059669, active), CRM & Sales (#818CF8→#4F46E5, grey + lock badge = locked), Accounting (#FBBF24→#D97706, "Soon" mint chip), Inventory, Projects, Manufacturing, Reports & BI. Labels 13px white under each tile. States: 10-tile pulsing skeleton; empty "No apps match your search." with "Clear search"; error card "We couldn't load the app catalog." + "Try again". Footer hint for admins: "Locked apps open the plan configurator — add them any time." Add a small caption on locked tiles for non-admins: "Ask your admin to add this app". Keep the Manage plan button reachable on mobile.
```

---

## Manage your plan  `/plan`
- **File:** `pages/Plan.tsx` (hooks: `core/api/modulePlans.ts`, `modules/hrms/api/useSeats.ts`)  ·  **Sidebar:** not in sidebar — reached from `/modules` "Manage plan", locked tiles (`/plan?add=…`), Settings › Billing & Plan "Manage plan / Choose modules / Change seats / Set up autopay", `ModuleNotActivated` "Activate {module}"  ·  **Roles:** in-page guard `ADMIN_ROLES` = OWNER, SUPER_ADMIN, COMPANY_ADMIN or `*`; no RouteGuard.
- **Status:** LIVE — `GET /v1/workspace/plan/current`, `GET /v1/public/module-plans`, `GET /v1/workspace/seats/usage`, `POST /v1/workspace/plan/setup-autopay`, `POST …/setup-autopay/cancel`, `POST …/plan/change-seats`, `POST …/plan/cancel`, `POST …/plan/recover`, status polling; Razorpay checkout in a new tab.

### Purpose
The workspace owner picks modules, sets seat counts per module, chooses monthly/annual, and sets up Razorpay autopay (7-day free trial on first purchase). Also where they change seats or cancel an existing subscription and recover a stranded payment.

### Layout (map to the design-system parts)
1. Page header: "← Back to apps" link, H1 "Manage your plan", subtitle "Pick modules for {tenantName} and set the seat count for each. First 7 days are free — autopay kicks in after." (or "Billing starts on your first day." once the trial is used).
2. Banners (stacked, amber/red/mint): seat-overage "You've exceeded your seat cap" (grandfathered tenants only); "We couldn't load your current plan" + **Retry** (blocks purchase); "You have a payment we haven't confirmed yet" + **I paid but it's still locked** / **Dismiss**; success banner `changeMessage`.
3. **Your current plan** — one `ut-card` per active subscription: icon tile, `displayName`, hand-styled status pill (No autopay set up / Active / 7-day trial / Payment retrying / Payment failed — grace period / Paused / raw status), "{seats} seats" or "Seat count not set", "₹{amountInr}/mo|yr", "next charge 18 Oct 2026" (unbilled: "unlocked · choose how many to pay for"); seat stepper (− / number / +) for billed subs; unbilled subs get an amber "nothing is being charged" note with a stepper feeding the summary; "Seat changes are paused while your autopay is {status}" note; pending-change note "Add 3 seats, taking you to 28." / "Reduce to 22 seats." + UPI re-approval sentence + **Confirm change** / **Cancel**; "Your subscription is cancelled. Access continues until …"; **Cancel subscription** text link (only for billed + `autoRenew` + ACTIVE/TRIALING).
4. Grid `1fr / 360px`: left "Add another module" list — `ut-card` per plan not yet owned: icon, name, "Launching soon" chip or "₹{priceInr}/user/month · ₹{annualUnit}/user/mo billed yearly", seat stepper (0–999) or **Locked** pill; 4 skeleton cards while loading.
5. Right sticky **summary card** (emerald header "Your plan" + selected names): Monthly/Annual toggle ("Save 10%"), line items "HR & Payroll · 25  ₹9,750", **Today ₹0** total, trial note "Autopay of ₹9,750/mo begins after your 7-day free trial. Cancel anytime.", error box, CTA button ("Pay ₹0 & Set Up Autopay" / "Set Up Autopay & Pay ₹9,750" / "Setting up autopay…"), "Secured by Razorpay" caption.
6. **Waiting-for-mandate overlay** (fixed, `ut-card` max-w-md): spinner, "Waiting for mandate approval…", copy about the Razorpay tab, buttons "I'm on the Razorpay tab → focus it" / "Reopen the Razorpay payment page", "Already paid? Check now", "Cancel and edit my selection".
7. Non-admin guard card: lock icon, "Only workspace admins can manage the plan", "Ask your admin to open Manage Plan and add modules for you.", **← Back to apps**.

### Data shown
- Subscriptions: `GET /v1/workspace/plan/current` → `primaryPlanKey`, `planKeys`, `seats`, `billingCycle` (MONTHLY/ANNUAL/null), `unitPriceInr`, `amountInr`, `status` (ACTIVE / TRIALING / PAST_DUE / HALTED / cancelled…), `nextChargeAt`, `graceUntil`, `razorpaySubscriptionId`, `billed`; `freeTrialUsed`.
- Catalog: `GET /v1/public/module-plans` (`priceInr`, `status`, `tagline`, `icon`).
- Seats: `GET /v1/workspace/seats/usage` → `purchased`, `current` (admins only).
- Pending checkout id/url persisted in `localStorage`; status polled on an interval while `awaitingMandate`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Back to apps | header / guard card | `navigate('/modules')` | all | LIVE |
| Retry | plan-load-failed banner | re-`fetchCurrent()` | admins | LIVE |
| I paid but it's still locked | pending banner / overlay ("Already paid? Check now") | `POST /v1/workspace/plan/recover` → toast "Payment successful" → `navigate('/modules')` | admins | LIVE |
| Dismiss / Cancel and edit my selection | pending banner / overlay | `POST /v1/workspace/plan/setup-autopay/cancel`, clears local pending | admins | LIVE |
| − / + / number | current-plan card (billed) | `bumpPending` (1–999); disabled when not ACTIVE/TRIALING or UPI-fixed | admins | LIVE |
| Confirm change | current-plan card | `POST /v1/workspace/plan/change-seats` → either opens Razorpay tab (UPI re-auth) or applies in place + `changeMessage` | admins | LIVE |
| Cancel (pending change) | current-plan card | clears pending seats | admins | LIVE |
| − / + / number | current-plan card (unbilled) | writes `seatsByPlan` → summary | admins | LIVE |
| Cancel subscription | current-plan card | native `window.confirm("Cancel this subscription?…")` → `POST /v1/workspace/plan/cancel` → toast "Subscription cancelled" / "Subscription was already cancelled"; label "Cancelling…" while pending | admins | LIVE |
| − / + / number (0–999) | module picker row | `dec/inc/setSeats` | admins | LIVE |
| Monthly / Annual | summary | `setBillingCycle` | admins | LIVE |
| Pay ₹0 & Set Up Autopay / Set Up Autopay & Pay ₹… | summary CTA | `POST /v1/workspace/plan/setup-autopay` → opens Razorpay checkout in new tab → polling → toast "Payment successful" → `/modules`; disabled when nothing selected / load failed | admins | LIVE |
| I'm on the Razorpay tab → focus it / Reopen the Razorpay payment page | overlay | `checkoutTab.focus()` or `window.open(checkoutUrl)` | admins | LIVE |

### States
- loading: 4 skeleton cards; `activeSubsLoading`.
- empty: summary "No modules selected" / "Set a seat count on any module to see your total here."
- error: red "We couldn't load your current plan" (purchasing paused); inline summary error box.
- pending / awaiting mandate overlay; seat-overage amber banner; cancelled-with-grace note; "Launching soon" + **Locked** for unavailable plans.
- no-permission: in-page guard card (not the shell's Access Restricted).

### Rules & permissions
- Only ADMIN_ROLES may purchase; duplicate purchase blocked when current plan cannot be loaded; UPI mandates cannot be modified (Razorpay rule — seat change re-authorises); seat stepper min 1 on billed subs; 7-day trial once per workspace; `SeatQuotaEnforcer` 402 blocks employee creation over cap (hard block for new tenants; banner for grandfathered ones — `TODO(billing-ceiling)` in file).

### Gaps & plan  (keep / add / change)
- **Keep:** honest recovery path for stranded payments; in-place seat change; Razorpay-secured CTA wording; ₹ en-IN formatting.
- **Add:** [code: `TODO(billing-ceiling)` in Plan.tsx] retire the seat-overage banner and `BILLING_OVER_CAP` notification once the Razorpay ceiling flow ships. [code: Settings.tsx BillingTab] invoice history ("Downloadable invoice history is coming to this page soon") needs Razorpay invoice API.
- **Change:** the page is a 1,304-line single component with hand-rolled cards and buttons — rebuild on `HrPageHeader`, `HrStatCard` (Seats purchased / Active employees / Next charge — `useSeatsUsage` already returns `purchased`/`current` and is only used for the overage banner), `HrStatusPill` for subscription status (today a hand-styled span with a different label set from Settings › Billing: "Payment failed — grace period" vs "Payment failed"), `Modal` + `useConfirmDialog()` for "Cancel subscription" (today a native `window.confirm`, off-system). [code: local `ADMIN_ROLES`] omits ADMIN — align with `useRoles.ADMIN_ROLES` (see shell).

### Screenshot
`Attach: /plan — current screen (with one active subscription and the module picker)`

### Claude Design prompt (ready to paste)
```
Design "Manage your plan" for OWNER / COMPANY_ADMIN. HrPageHeader crumb "Settings", title "Manage your plan", subtitle "Pick modules for Ionora Technologies and set the seat count for each. First 7 days are free — autopay kicks in after.", back link "← Back to apps". KPI strip of 3 HrStatCard: "Paid seats 25", "Active employees 28" (red trend when over cap), "Next charge 18 Oct 2026 · ₹9,750/mo". Section "Your current plan": one card per subscription — icon, "HR & Payroll", HrStatusPill (ok "Active" / info "7-day trial" / warn "Payment retrying" / red "Payment failed — grace period" / gray "Paused" / warn "No autopay set up"), "25 seats · ₹9,750/mo · next charge 18 Oct 2026", seat stepper − 25 +, pending note "Add 3 seats, taking you to 28." with "Confirm change" / "Cancel", quiet "Cancel subscription" link that opens a confirm Modal (replacing today's browser confirm). Section "Add another module": rows "CRM & Sales — ₹39/user/month · ₹35/user/mo billed yearly" with stepper, "Accounting — Launching soon / Locked". Right sticky summary card with emerald header "Your plan — HR & Payroll · CRM & Sales", Monthly | Annual (Save 10%) toggle, line items "HR & Payroll · 25  ₹9,750", big "Today ₹0", note "Autopay of ₹9,750/mo begins after your 7-day free trial. Cancel anytime.", primary button "Pay ₹0 & Set Up Autopay", caption "Secured by Razorpay". Include banners: amber "You've exceeded your seat cap", amber "You have a payment we haven't confirmed yet" with "I paid but it's still locked", red "We couldn't load your current plan" + Retry; and the full-screen "Waiting for mandate approval…" overlay with its three buttons. Non-admins see a lock card "Only workspace admins can manage the plan".
```

---

## Workspace Settings  `/settings`, `/settings/:tab`, `/settings/billing`, `/settings/danger`
- **File:** `pages/Settings.tsx`  ·  **Sidebar:** Settings scope › Profile · Branding · Security · Notifications · Billing & Plan · Integrations · Danger Zone (`SETTINGS_NAV`); HRMS scope › "Company settings" rail pin + header Settings icon; profile menu "Settings"; `PLATFORM_ITEMS` "Configuration" → `/settings`  ·  **Roles:** `/settings` and `/settings/:tab` RouteGuard anyOf `SETTINGS_READ`, `SETTINGS_HRCONFIG_WRITE`, `SETTINGS_HOLIDAYS_WRITE`, `HRMS_PROBATION_CONFIG_READ` (sidebar: OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD); Branding nav OWNER/SUPER_ADMIN/COMPANY_ADMIN; `/settings/billing` RequirePermission `WORKSPACE_BILLING_MANAGE` (nav SUPER_ADMIN/OWNER/COMPANY_ADMIN); `/settings/danger` RequirePermission `TENANT_SETTINGS_WRITE` (nav SUPER_ADMIN/OWNER); Security, Notifications, Integrations nav open to all roles that reach the scope.
- **Status:** PARTIAL — Branding (GET/POST `/v1/workspace/branding[/logo]`), Security password reset (`POST /v1/auth/forgot-password`) and Billing (`GET /v1/workspace/plan/current`) are live; Profile tab is read-only store data; Notifications and Integrations are "Launching soon" roadmap rows; Danger Zone is three `mailto:` links.

### Purpose
Workspace-level (not HR-module) configuration for admins: identity/branding, account security, billing, and the destructive requests. The tab comes from the URL; the shell rail is the tab navigation.

### Layout (map to the design-system parts)
1. `HrPageHeader` crumb "Workspace Settings", title = tab label, subtitle = tab desc (from `TAB_META`).
2. One `ut-card ut-card-lg` body containing the active tab:
   - **Profile:** "Personal Information" — 64px gradient initials tile, name + email; 4 read-only inputs (First Name, Last Name, Email Address, Role); "Organization" — read-only Company Name, Subdomain, Plan; footer note "These details are read-only for now. To change your name or company details, contact unifiedtree@gmail.com." (no Save button — deliberate, see file comment).
   - **Branding:** heading "Workspace logo" + help text (PNG/JPEG/GIF/WebP/AVIF ≤ 2 MB, header renders at 28px); amber block when GET is 402/403; `ut-card` row: 96px dashed preview (logo or ImageIcon), "Custom logo set" / "No custom logo yet" + caption, `HrButton` **Upload logo / Replace logo / Uploading…**, ghost **Open image**; footnote "Uploaded to Cloudflare R2…".
   - **Security:** "Password" — copy "We'll email a secure reset link to {email}…", `HrButton` **Email me a password reset link** → mint success box "Reset link sent. Check your inbox (and spam folder)."; "Two-Factor Authentication" → `SoonRow` "Authenticator App" (Launching soon); "Active Sessions" → `SoonRow` "Device & session management".
   - **Notifications:** info card "Per-person notification controls are on the way" + what admins currently receive; "Email Notifications" 6 rows (New employee joined · Leave request submitted · Payroll processed · Deal status changed · Critical tickets opened · Invoice overdue) and "Push Notifications" 3 rows (All notifications · Critical alerts only · Mentions & assignments), each with a "Launching soon" chip, no toggles.
   - **Billing & Plan:** "Your plan" + **Manage plan** button; skeleton / red error / empty card "No modules on autopay yet" + **Choose modules** / one `ut-card` per subscription: plan keys, `HrStatusPill` (Active / 7-day trial / Payment retrying / Payment failed / No autopay set up), "{seats} seats · ₹9,750/mo · next charge 18 Oct 2026 · unlocked, but nothing is being charged", button **Change seats** / **Set up autopay**; "Invoices" paragraph (Razorpay emails invoices; history coming soon).
   - **Integrations:** intro paragraph + 6 roadmap rows (Slack, GitHub, Jira, Zapier, Stripe, Salesforce) with emoji logo and "Launching soon" chip.
   - **Danger Zone:** info card "These actions are handled by our team…"; 3 red cards — Export all data (**Request data export**), Reset workspace (**Request workspace reset**), Delete organisation (**Request deletion**, stronger red) — each CTA is a `mailto:unifiedtree@gmail.com?subject=…` link.

### Data shown
- Profile: `useAuthStore.user` (firstName, lastName, email, role), `tenant` (name, subdomain, planType). Local store, not fetched.
- Branding: `GET /v1/workspace/branding` → `logoUrl`; `POST /v1/workspace/branding/logo` (multipart, bearer from `getAccessToken()`); `refreshTenant()` after upload.
- Security: `POST /v1/auth/forgot-password` `{email}`.
- Billing: `GET /v1/workspace/plan/current` → `BillingSubDto[]` (same shape as `/plan`).
- Notifications / Integrations / Danger: static arrays.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tab (Profile … Danger Zone) | shell rail (Settings scope) | route `/settings/{tab}`; unknown tab → Profile | per `SETTINGS_NAV` roles | LIVE |
| mailto unifiedtree@gmail.com | Profile footer | opens mail client | all | LIVE |
| Upload logo / Replace logo | Branding | file picker → client 2 MB check → `POST /v1/workspace/branding/logo` → toast "Logo updated"; disabled while uploading or when GET returned 402/403 | branding admins (server 403 otherwise) | LIVE |
| Open image | Branding | `window.open(logoUrl)` | same | LIVE |
| Email me a password reset link | Security | `POST /v1/auth/forgot-password` → "Reset link sent" (always shows success — anti-enumeration) | all | LIVE |
| Authenticator App | Security | none — "Launching soon" | — | STUB |
| Device & session management | Security | none — "Launching soon" | — | STUB |
| Email / Push notification rows ×9 | Notifications | none — "Launching soon" | — | STUB |
| Manage plan | Billing header | `navigate('/plan')` | `WORKSPACE_BILLING_MANAGE` | LIVE |
| Choose modules | Billing empty card | `navigate('/plan')` | same | LIVE |
| Change seats / Set up autopay | Billing sub card | `navigate('/plan')` | same | LIVE |
| Slack … Salesforce | Integrations | none — "Launching soon" | — | STUB |
| Request data export / Request workspace reset / Request deletion | Danger Zone | `mailto:` with prefilled subject + body (workspace, organisation) | `TENANT_SETTINGS_WRITE` | PARTIAL (manual process) |

### States
- Billing: `subs === null` pulsing card; `failed` red "We couldn't load your billing details just now. Open Manage plan to see the latest."; empty "No modules on autopay yet".
- Branding: `loadBlocked` amber (402 "Your subscription has ended…" / 403 "You don't have permission for this"); upload errors mapped by status (0/401/402/403/413/415/429/5xx) to human toasts.
- Security: `sent` success box replaces the button.
- no-permission: shell "Access Restricted" for the route; billing/danger deep-links blocked by `RequirePermission`.

### Rules & permissions
- Profile and Organization fields are read-only because no update endpoint exists (`TenantController` has no update mapping — file comment). Industry field removed (never persisted).
- Logo: server enforces PNG/JPEG/WebP, magic-byte sniffed, 2 MB, SVG blocked. Public R2 URL.
- 2FA flag exists in `auth.user_credentials.is_mfa_enabled` but no enrolment service; session listing/revoke endpoints do not exist; no per-user preferences endpoint (`NotificationsController` is the inbox only) — all per file comments.
- Danger actions are intentionally manual until real destructive endpoints exist (DPDP/GDPR wording in file).

### Gaps & plan  (keep / add / change)
- **Keep:** honest "Launching soon" rows instead of fake toggles; status-mapped upload errors; single card body per tab; billing sourced from the same endpoint as `/plan`.
- **Add:** [code: SecurityTab comment] 2FA enrolment + session list/revoke endpoints. [code: NotificationsTab comment] per-user notification preferences endpoint. [code: BillingTab] invoice history via Razorpay invoice API. [code: DangerTab comment] real export / reset / delete endpoints with `DeleteRoleConfirm`-style confirmation. [code: ProfileTab comment] workspace/account update endpoint so Company Name / names become editable. [BLUEPRINT §7 target IA › Settings] "HR Configuration · Holiday Calendar · Roles & Permissions · Notification Templates · Integrations · Audit Logs" — Holiday Calendar should be its own Settings leaf (§6 row 17). [BLUEPRINT §8.3] "Seats used → `/settings/billing`" drill-down from the dashboard — but `BillingTab` never calls `useSeatsUsage`, so the landing page does not show purchased vs used seats; add that line to the subscription card.
- **Change:** two "Integrations" screens exist (`/settings/integrations` roadmap vs `/hrms/integrations` live registry) and two "Notifications" concepts (`/settings/notifications` roadmap vs `/hrms/notification-templates`) — name them apart ("Connected apps (roadmap)" vs "HR integrations directory"). Profile tab duplicates `/profile` (which *is* editable) — link "Edit your personal details on My Profile". [code: `SETTINGS_NAV` has no `/settings` entry — `s-profile` points at `/profile`] the bare `/settings` route (header icon, "Company settings" pin, profile menu) renders the read-only Profile tab with no rail item highlighted; land on Branding or Billing instead. Tab body uses raw inputs instead of `Field`/`Input` (the `Toggle` component is defined but unused since the notification toggles were removed); the Billing subscription cards should reuse the `/plan` card and `HrStatusPill`.

### Screenshot
`Attach: /settings/billing — current screen (and /settings/security)`

### Claude Design prompt (ready to paste)
```
Design Workspace Settings for OWNER / COMPANY_ADMIN (HR_MANAGER and FINANCE_LEAD reach Profile/Security/Notifications/Integrations only). The rail is the tab list; the page is HrPageHeader crumb "Workspace Settings" + title/subtitle per tab, over one large white card. Tabs: Profile (read-only Field/Input rows First Name "Admin", Last Name "User", Email "owner@ionora.in", Role "Company Owner"; Organization: Company Name "Ionora Technologies Pvt Ltd", Subdomain "ionora", Plan "HR & Payroll"; note "These details are read-only for now…" and a link "Edit your personal details on My Profile"). Branding (96px dashed logo preview, "Custom logo set", HrButton "Replace logo", ghost "Open image", help "PNG, JPEG, GIF, WebP or AVIF, up to 2 MB"; amber block for expired subscription). Security (HrButton "Email me a password reset link" → mint success "Reset link sent. Check your inbox (and spam folder)."; rows "Authenticator App" and "Device & session management" with a "Launching soon" chip — no toggles). Notifications (info card "Per-person notification controls are on the way"; 6 email + 3 push rows each with "Launching soon"). Billing & Plan ("Your plan" + HrButton "Manage plan"; card "HR & Payroll" HrStatusPill "Active" · "25 seats · ₹9,750/mo · next charge 18 Oct 2026" · ghost "Change seats"; empty "No modules on autopay yet" + "Choose modules"; "Invoices" note). Integrations (6 roadmap rows Slack/GitHub/Jira/Zapier/Stripe/Salesforce, "Launching soon"). Danger Zone (info card, three red cards "Export all data / Reset workspace / Delete organisation" with outline red buttons "Request data export / Request workspace reset / Request deletion" that open email). Rename the tab "Integrations" to "Connected apps" so it is not confused with HR Setup › Integrations.
```

---

## My Profile  `/profile`
- **File:** `pages/Profile.tsx` (hook `shared/hooks/useCurrentUser.ts`)  ·  **Sidebar:** Settings scope › Profile (`SETTINGS_NAV` s-profile, all roles) — but `/profile` itself resolves to HRMS scope, so once opened the rail shows the HRMS sections again; profile popover "My Profile"; ⌘K action "My Profile"  ·  **Roles:** every authenticated user (auth-only route, no permission gate; backend `/v1/users/me` enforces self-only).
- **Status:** PARTIAL — name/phone/avatar/notification prefs are live (`GET/PUT /v1/users/me`, avatar upload); the "Employment Information (Static)" and "Bank Details (Static)" cards, the job title, the location and the "Active Employee" pill are hard-coded.

### Purpose
One screen for "everything about me": the signed-in person changes their display name, contact phone, photo and two notification switches. Any role.

### Layout (map to the design-system parts)
1. `HrPageHeader` crumb "My Account", title "Profile", subtitle "Your personal details, avatar and notification preferences."
2. `ut-card ut-card-lg` body, 3-column grid:
   - Left card: 96px avatar (image or initials on #059669→#047857 gradient; spinner overlay while uploading), `fullName`, **"Senior Software Engineer"** (hard-coded), `HrStatusPill` ok **"Active Employee"** (hard-coded), contact list ✉ email · 📞 phone (fallback **"+91 98765 43210"** hard-coded) · 📍 **"Bangalore, India"** (hard-coded), `HrButton` sm **Change photo / Uploading…**.
   - Right column: card "Employment Information (Static)" — Employee ID **EMP-2023-085**, Date of Joining **Jan 15, 2023**, Department **Engineering**, Reporting Manager **Sarah Jenkins** (all hard-coded); card "Bank Details (Static)" — HDFC Bank, XXXX-XXXX-4567, HDFC0001234, ABCDE1234F (all hard-coded).
3. Divider; "Personal settings": Display name (input), Contact phone (tel, hint "Used for account recovery only."), Email address (read-only, hint "Change your email from the Security page.").
4. Divider; "Notification preferences" (+ "See Settings → Notifications for the full per-event list."): `PrefRow` toggles "Email notifications — Approvals, payroll receipts, security alerts." and "Push notifications — In-app and mobile push for real-time events."
5. Footer: **Discard** (outline) + `HrButton` **Save changes / Saving…** (both disabled until dirty).
6. `ProfileSkeleton` while loading; red error card "Couldn't load your profile" + **Try again**.

### Data shown
- `useCurrentUser()` → `GET /v1/users/me`: `id`, `displayName`, `firstName`, `lastName`, `email`, `phone`, `avatarUrl`, `notificationPreferences.emailEnabled/pushEnabled`.
- `useUpdateCurrentUser()` → `PUT /v1/users/me` with a diff-only patch; `useUploadAvatar()` → multipart upload (optimistic + rollback). All writes invalidate `['user','me']`.
- Static: job title, status pill, location, employment card, bank card.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Change photo | left card | hidden file input; client checks type (JPG/PNG/WebP/HEIC/GIF/BMP or blank) + ≤ 5 MB; `useUploadAvatar` → toast "Avatar updated" / mapped error (413/415/401/403/5xx) | all | LIVE |
| Display name / Contact phone | Personal settings | edits local draft | all | LIVE |
| Email notifications / Push notifications | toggles | edits local draft | all | LIVE |
| Discard | footer | resets draft to server row | all | LIVE |
| Save changes | footer | `PUT /v1/users/me` diff → toast "Profile updated" / "Nothing to save" / "Could not save changes" | all | LIVE |
| Try again | error card | `refetch()` | all | LIVE |

### States
- loading: `ProfileSkeleton` (role=status "Loading profile"); error card; `upload.isPending` spinner over avatar; buttons disabled when `!dirty`.

### Rules & permissions
- Self-only (backend). Email is not editable here. Unchanged fields are omitted from the PUT so partial patches never overwrite. Avatar 5 MB / accepted MIME list must match `UserAvatarController.ImageFormat`.

### Gaps & plan  (keep / add / change)
- **Keep:** diff-only save, optimistic avatar, one screen for personal prefs.
- **Add:** [code: hard-coded "(Static)" cards in Profile.tsx] wire Employment Information and Bank Details to the linked employee record (`user.employeeId` exists on `WorkspaceUser`; the profile API family `/v1/employees/{id}/profile/*` is retained as canonical per [BLUEPRINT §25.4]) or remove them. [BLUEPRINT §21 ESS] "My Profile — editable personal details" for employees. [code: `PlatformShell.tsx` `scope()`] keep `/profile` inside the Settings scope so the rail does not flip.
- **Change:** remove fabricated values ("Senior Software Engineer", "+91 98765 43210", "Bangalore, India", "EMP-2023-085", "Sarah Jenkins", HDFC bank row) — a real user sees someone else's data under their own login (same class of problem the audit removed elsewhere). Emoji glyphs (✉ 📞 📍) → lucide icons. The notification toggles here persist while `/settings/notifications` says "Per-person notification controls are on the way" — align the copy.

### Screenshot
`Attach: /profile — current screen`

### Claude Design prompt (ready to paste)
```
Design My Profile for every role. HrPageHeader crumb "My Account", title "Profile", subtitle "Your personal details, avatar and notification preferences." Left card: 96px avatar (photo or initials "PN" on emerald), name "Priya Nair", job title from the employee record "Senior Engineer · Engineering" (or hidden when the user has no employee record), HrStatusPill "Active" from the employee status, rows with lucide Mail/Phone/MapPin: priya.nair@ionora.in · +91 98450 12345 · Hyderabad; HrButton sm "Change photo" (accepts JPG/PNG/WebP/HEIC/GIF ≤ 5 MB, spinner overlay while uploading). Right column: "Employment" card — Employee ID EMP-0142, Date of joining 18 Sep 2023, Department Engineering, Reporting manager Rahul Verma — sourced from the linked employee, with an EmptyState "No employee record linked to this login" for user-only accounts; drop the bank-details card. Below: "Personal settings" Fields Display name, Contact phone (hint "Used for account recovery only."), Email (read-only, hint "Change your email from the Security page."). "Notification preferences": two toggle rows "Email notifications — Approvals, payroll receipts, security alerts." and "Push notifications — In-app and mobile push for real-time events." Footer: outline "Discard" + HrButton "Save changes", both disabled until something changes. States: skeleton; error card "Couldn't load your profile" + "Try again"; toasts "Profile updated" / "Nothing to save".
```

---

## Users & Access (Workspace Users)  `/users`
- **File:** `pages/Users.tsx` + `pages/users/InviteWorkspaceUserModal.tsx` + `pages/users/ManageAccessDrawer.tsx` (hooks `modules/rbac/api/useWorkspaceAccess.ts`)  ·  **Sidebar:** Settings scope › Users & Access (`PLATFORM_ITEMS` users / `SETTINGS_NAV` s-users: OWNER, SUPER_ADMIN, COMPANY_ADMIN); ⌘K action "Workspace Users"  ·  **Roles:** RouteGuard anyOf `WORKSPACE_USERS_READ`; page wraps `<Can code=WORKSPACE_USERS_READ>` with a forbidden EmptyState; Invite / Resend / Manage access need `WORKSPACE_USERS_MANAGE`.
- **Status:** LIVE — `useWorkspaceUsers` → `GET /v1/workspace/users`; invite, resend, assign/revoke mutations all wired.

### Purpose
The workspace admin sees who can log in, what module roles each person holds, invites a teammate (optionally creating the HRMS employee at the same time), resends a pending invitation, and toggles roles per user.

### Layout (map to the design-system parts)
1. `HrPageHeader` crumb "Settings", title "Workspace Users", subtitle "{n} members in your workspace", actions `HrButton` **+ Invite User** (Can MANAGE).
2. `TableSkeleton` / `EmptyState` variants (error "Couldn't load users", first-run "No workspace users yet — Invite your first teammate to get started." with primary action Invite User).
3. `TableCard` with `search` ("Search by name or email…") wrapping an `hr-table`: **User** (`HrAvatar name sub` — sub = email, or "email · user only" when `employeeId == null`) · **Roles** (`RolesCell`: per module label HRMS / CRM / Accounts / Attendance / Leave / Platform → `HrStatusPill info` per role displayName; "No access" warn pill when none) · **Status** (`HrStatusPill` ok Active / warn Invited / gray Inactive) · **Actions** (right): text buttons **Resend invitation / Retry invitation / Sending…** (INVITED only) and **Manage access**.
4. Filtered-empty `EmptyState` "No matches — Try a different search."
5. **Invite Workspace User** `Modal` (md): description "Add a teammate and grant their access."; `Field` Email (required, placeholder "name@company.com"), First name / Last name grid; checkbox card "Also create HRMS employee — Creates a payroll/directory record in HRMS. Uncheck to grant login + roles only…"; "Roles" grouped by module with checkboxes (EMPLOYEE pre-checked); inactive module groups greyed with "Activate this module to assign roles. Activate {Module} →" link to `/settings`; footer `Button` secondary **Cancel** + primary **Send invite** (loading).
6. **Manage access — {name}** `Drawer`: email line; per module group (label + `Badge` "Inactive") a `ut-card ut-card-sm` row per role with a switch (or Lock icon when the module is inactive) + "Activate {Module} →" link; footer ghost **Done**.
7. **Remove last role?** `Modal` ("Removing this role leaves the user with no access. Continue?" + "{name} ({email}) will have no roles and will see a No-Access screen until a new role is granted."): **Cancel** / danger **Remove role**.

### Data shown
- `GET /v1/workspace/users` → `userId`, `email`, `firstName/lastName/displayName` (via `workspaceUserDisplayName`), `employeeId`, `status` (ACTIVE / INVITED / INACTIVE), `roles[{roleCode, displayName, module}]`, `invitationSendStatus` (PENDING / FAILED / …), `lastSendError`.
- `GET /v1/workspace/assignable-roles` → `roleCode`, `displayName`, `module`, `moduleActive`.
- `useCompanies()` → first company id used when creating the employee.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| + Invite User | header / first-run empty state | opens Invite modal | `WORKSPACE_USERS_MANAGE` | LIVE |
| Search by name or email… | TableCard toolbar | client filter on email + display name | READ | LIVE |
| Resend invitation / Retry invitation | row (INVITED) | `POST /v1/workspace/users/{userId}/invite/resend` → toast "Invitation resent to {email}"; disabled while sending or `PENDING`; title shows `lastSendError` on FAILED | MANAGE | LIVE |
| Manage access | row | opens Manage access drawer | MANAGE | LIVE |
| Send invite | Invite modal footer | validates email (+ company when creating employee) → `POST /v1/workspace/users/invite` `{email, firstName, lastName, createEmployee, roleCodes, companyId}` → toast "User invited and HRMS employee created" / "User invited" | MANAGE | LIVE |
| Cancel | Invite modal | closes | MANAGE | LIVE |
| Also create HRMS employee | Invite modal | toggles `createEmployee` (default on) | MANAGE | LIVE |
| Role checkbox | Invite modal | toggles role code; disabled when module inactive | MANAGE | LIVE |
| Activate {Module} → | Invite modal / drawer | `Link` → `/settings` | MANAGE | LIVE — see Change |
| Role switch on | drawer | `POST /v1/workspace/users/{userId}/roles` → toast "{role} granted" | MANAGE | LIVE |
| Role switch off | drawer | `DELETE /v1/workspace/users/{userId}/roles/{roleCode}` → toast "{role} removed"; if it is the last role → confirm modal | MANAGE | LIVE |
| Remove role | confirm modal | same DELETE → warning toast "Role removed — user now has no access" | MANAGE | LIVE |
| Done | drawer footer | closes | MANAGE | LIVE |

### States
- loading `TableSkeleton`; error EmptyState "Couldn't load users — Please try again."; first-run; filtered "No matches"; no-permission EmptyState forbidden "Access restricted — You don't have permission to manage workspace users."; row states Sending… / Retry (red) / "No access" pill; drawer switches disabled while any mutation is pending.

### Rules & permissions
- Invite requires an email; creating an employee requires at least one company (`companies[0]`). Roles are grouped by module; a role can only be granted when its module is active (`moduleActive` from backend, fallback `hasModule`). Privileged roles are excluded server-side (`WorkspaceAccessService.EXCLUDED_ROLES`). Last-role removal needs confirmation. Tenant-scoped by JWT.

### Gaps & plan  (keep / add / change)
- **Keep:** invite + employee creation in one step; module-grouped role pills; honest resend states; last-role confirm. [FUNCTIONALITY_AUDIT › route table] "/users, /roles, /settings — Owner route smoke; 64 endpoint checks across eight company roles".
- **Add:** [HANDOFF §10 G] "Test eight company roles and representative custom permissions across actual workflows… list pagination, bulk actions and realistic data sizes" — the table has no pagination or status filter (`HrPagination` / `FilterBar` by Status and Module). [code: no deactivate action] no way to deactivate/remove a user — only role removal ("Inactive" status is displayed but never set from this page).
- **Change:** "Activate {Module} →" links to `/settings` (Profile tab) — should go to `/plan`, where modules are actually added. Invite modal uses the first company silently; when the tenant has >1 company, show a Company `HrSelect`. Row actions are hand-styled text buttons — use `HrButton size="sm" variant="ghost"`. Table is a raw `hr-table` — use `DataTable`.

### Screenshot
`Attach: /users — current screen (and the Manage access drawer)`

### Claude Design prompt (ready to paste)
```
Design Workspace Users for OWNER / COMPANY_ADMIN / SUPER_ADMIN. HrPageHeader crumb "Settings", title "Workspace Users", subtitle "24 members in your workspace", action HrButton "+ Invite User". TableCard with search "Search by name or email…" and FilterBar Status (All / Active / Invited / Inactive) and Module (HRMS / CRM / Platform); DataTable columns: User (HrAvatar "Priya Nair" sub "priya.nair@ionora.in" or "… · user only"), Roles (module label HRMS + HrStatusPill info "HR Manager", "Employee"; "No access" warn pill), Status (HrStatusPill Active/Invited/Inactive), Actions (ghost sm "Resend invitation" only for Invited — red "Retry invitation" when the last send failed — and "Manage access"); footer HrPagination "1–25 of 24". Invite modal (md): Fields Email*, First name, Last name, Company HrSelect (when >1), checkbox card "Also create HRMS employee", role checklist grouped HRMS / Platform with inactive groups locked + link "Activate CRM → Manage plan"; footer Cancel / "Send invite". Manage access drawer "Manage access — Priya Nair": email, per-module role rows with switches (Lock icon + "Inactive" badge when the module is off), footer "Done"; confirm Modal "Remove last role?" with danger "Remove role". States: TableSkeleton; error "Couldn't load users"; first-run "No workspace users yet — Invite your first teammate to get started."; forbidden "Access restricted". Add a row action "Deactivate user" (confirm dialog) as a new requirement.
```

---

## Roles & Permissions (Role Management)  `/roles`
- **File:** `pages/Roles.tsx` (hooks `modules/rbac/api/useRbac.ts`, `useWorkspaceAccess.ts`)  ·  **Sidebar:** Settings scope › Roles & Permissions (`PLATFORM_ITEMS` roles / `SETTINGS_NAV` s-roles: OWNER, SUPER_ADMIN, COMPANY_ADMIN); ⌘K action "Roles & Permissions"  ·  **Roles:** RouteGuard anyOf `RBAC_ROLE_WRITE`, `PLATFORM_ADMIN`; write actions gated by `<Can code=RBAC_ROLE_WRITE>`.
- **Status:** LIVE — `GET /v1/rbac/roles`, `GET /v1/rbac/permissions`, `GET/PUT /v1/rbac/roles/{id}/permissions`, `POST/PUT/DELETE /v1/rbac/roles[/{id}]`, `GET /v1/rbac/users/{id}/roles`, `POST/DELETE /v1/rbac/users/{id}/roles/{roleId}`.

### Purpose
Admin defines tenant roles (create / clone a system role / edit / delete), edits the permission set of a role, assigns roles to users and inspects a user's effective permissions, and browses the permission catalogue by module.

### Layout (map to the design-system parts)
1. Raw H1 "Role Management" + "View roles and manage permission assignments" (not `HrPageHeader`).
2. `HrTabs`: **Roles** · **Assignments** · **Permission Catalogue**.
3. **Roles tab:** right-aligned `Button` sm **+ New role** (Can); `TableSkeleton` / error `EmptyState` "Failed to load roles" + Retry / `DataTable` columns **Role** (shield tile, displayName + mono code) · **Description** (hide < md) · **Type** (`Badge` info "System" / default "Tenant") · actions (icon buttons: KeyRound "View/Edit permissions", Copy "Clone", Pencil "Edit" (tenant only), Trash2 "Delete" (tenant only)); row click opens the permissions drawer; empty "No roles found — Roles will appear here once the tenant is provisioned."
4. **Assignments tab:** grid `300px / 1fr` — left `ut-card` user list with search "Search users…" (rows name + email, selected = accent); right `ut-card` detail: name/email, "ASSIGNED ROLES" chips with ✕ revoke, "GRANT A ROLE" `select` ("Select a role to grant…" / "All roles already assigned"; options "{name} (system|tenant)"), "EFFECTIVE PERMISSIONS ({n})" mono code chips; placeholder "Select a user to view and manage their role assignments."
5. **Permission Catalogue tab:** module filter pills (All + each module) + `DataTable` **Permission code** (mono) · **Name** · **Module** (`Badge`) · **Description** (hide < lg); empty "No permissions in module "{m}"." / "No permissions registered."
6. **{Role} — Permissions** `Drawer`: read-only note for system roles ("System role permissions are fixed. Clone this role from the roles list to customize access for your company."); summary bar "{n} of {total} permissions granted" + "● Unsaved changes"; per-module accordion header (click toggles all; badge "3/7 partial" / "✓ all" / "none") with checkbox rows (displayName + mono code); footer ghost **Cancel/Done** + **Save permissions**.
7. **Role editor** `Drawer` ("New role" / "Clone “{name}”" / "Edit “{name}”"): Role code* (create/clone; "Uppercase identifier, unique within your workspace. Spaces become underscores."), Display name*, Description; clone note "Permissions will be copied from {name}…"; footer **Cancel** / **Create role** or **Save changes**.
8. **Delete “{name}”?** `Drawer`: warning copy; **Cancel** / red **Delete role**.

### Data shown
- Roles: `id`, `code`, `displayName`, `description`, `systemRole`. Permissions: `code`, `displayName`, `module`, `description`. User roles view: `roles[]`, `effectivePermissions[]`. Users list from `GET /v1/workspace/users`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Roles / Assignments / Permission Catalogue | HrTabs | switches tab (local state) | route roles | LIVE |
| + New role | Roles toolbar | opens editor (create) | RBAC_ROLE_WRITE | LIVE |
| Row click / KeyRound icon | Roles row | opens Permissions drawer (read-only for system roles) | RBAC_ROLE_WRITE (icons) / any (row click) | LIVE |
| Clone | Roles row | opens editor (clone, code `{CODE}_COPY`, name "{name} (Copy)") | RBAC_ROLE_WRITE | LIVE |
| Edit | Roles row (tenant) | opens editor (edit) | RBAC_ROLE_WRITE | LIVE |
| Delete | Roles row (tenant) | opens delete confirm | RBAC_ROLE_WRITE | LIVE |
| Retry | error EmptyStates | `refetch()` | all | LIVE |
| Module header / checkbox | Permissions drawer | toggles all codes in module / one code | non-system roles | LIVE |
| Save permissions | drawer footer | `PUT /v1/rbac/roles/{id}/permissions` → toast "Permissions updated — {n} granted to {role}" | RBAC_ROLE_WRITE | LIVE |
| Cancel / Done | drawer footer | closes | all | LIVE |
| Retry (perms) | drawer error | `refetchPerms()` | all | LIVE |
| Create role | editor | `POST /v1/rbac/roles` `{code, displayName, description, cloneFromRoleId?}` → toast "Role created" / "Role cloned"; duplicate → "That role code already exists in this workspace" | RBAC_ROLE_WRITE | LIVE |
| Save changes | editor (edit) | `PUT /v1/rbac/roles/{id}` → "Role updated" | RBAC_ROLE_WRITE | LIVE |
| Delete role | delete drawer | `DELETE /v1/rbac/roles/{id}` → "Role deleted" | RBAC_ROLE_WRITE | LIVE |
| Search users… | Assignments | client filter | all | LIVE |
| User row | Assignments | selects → `GET /v1/rbac/users/{id}/roles` | all | LIVE |
| ✕ on role chip | Assignments | `DELETE /v1/rbac/users/{id}/roles/{roleId}` → "Removed {role}" | all with route access | LIVE |
| Select a role to grant… | Assignments | `POST /v1/rbac/users/{id}/roles/{roleId}` → "Role granted"; excludes assigned + `NON_ASSIGNABLE_ROLE_CODES` (SUPER_ADMIN, OWNER, ADMIN, MANAGER, PLATFORM_SUPER_ADMIN) | same | LIVE |
| All / {module} pills | Catalogue | client filter | all | LIVE |

### States
- loading `TableSkeleton` (roles, assignments while roles load, catalogue), "Loading users…", "Loading…", "Loading current permissions…"; errors with Retry ("Failed to load roles", "Failed to load permissions" catalogue EmptyState, "Failed to load current permissions" in the drawer); empties listed above; "No users match “{q}”."; "No roles assigned."; "No permissions — assign a role above."; system role = read-only drawer; "● Unsaved changes"; busy disables switches/selects.

### Rules & permissions
- System roles cannot be edited/deleted; clone them instead. Role code uppercased, spaces → underscores, unique per workspace (`ROLE_CODE_DUPLICATE`). Privileged roles are not grantable from Assignments (mirrors backend). Deleting a role removes it from every holder (copy in drawer).

### Gaps & plan  (keep / add / change)
- **Keep:** three-tab structure, module accordion with "n/m partial" badges, clone-from-system pattern, delete confirmation copy. [BLUEPRINT §6 row 52] "Roles & Permissions — Works — Surface in Settings" (done via `SETTINGS_NAV`).
- **Add:** [HANDOFF §10 G] custom-permission role coverage across real workflows; [BLUEPRINT §5 health] RBAC + cross-tenant isolation is "Strong" — keep the tests. A "Users with this role" count per row would use data already in `GET /v1/workspace/users` (evident: Assignments tab has it; Roles tab does not).
- **Change:** page header is a raw H1 — use `HrPageHeader` (crumb "Settings", title "Roles & Permissions"). Assignments duplicates `Users › Manage access` with a different mechanism (roleId select vs roleCode switches, and different exclusion lists) — pick one surface and link the other. Delete confirm is a `Drawer`, the DS convention is `Modal` + `useConfirmDialog()`. Catalogue pills and the grant `<select>` should be `FilterBar` / `HrSelect`.

### Screenshot
`Attach: /roles — current screen (Roles tab, plus the permissions drawer)`

### Claude Design prompt (ready to paste)
```
Design Roles & Permissions for OWNER / COMPANY_ADMIN / SUPER_ADMIN. HrPageHeader crumb "Settings", title "Roles & Permissions", subtitle "View roles and manage permission assignments", tabs (HrTabs with badge counts) Roles 9 · Assignments · Permission Catalogue 184, action HrButton "+ New role". Roles tab: DataTable columns Role (shield tile, "HR Manager" + mono "HR_MANAGER"), Description, Type (Badge "System" / "Tenant"), Users (count, new), row actions ghost icons Edit permissions / Clone / Edit / Delete (Edit + Delete hidden for System). HrDrawer "HR Manager — Permissions": read-only note for system roles, summary "42 of 184 permissions granted · ● Unsaved changes", per-module accordion (HRMS 12/20 partial, PAYROLL 0/15 none, PLATFORM 5/5 ✓ all) with checkbox rows "Read employees — hrms.employee.read", footer Cancel / "Save permissions". Role editor HrDrawer "Clone “HR Manager”": Fields Role code "REGIONAL_HR" (hint "Uppercase identifier, unique within your workspace. Spaces become underscores."), Display name "Regional HR", Description; note "Permissions will be copied from HR Manager…"; footer Cancel / "Create role". Delete → confirm Modal "Delete “Regional HR”?" with danger "Delete role". Assignments tab: two-pane — left TableCard user list with search; right card "Priya Nair · priya.nair@ionora.in", ASSIGNED ROLES chips with ✕, "Grant a role" HrSelect, EFFECTIVE PERMISSIONS (42) mono chips. Catalogue tab: FilterBar Module pills + DataTable Permission code / Name / Module / Description. States: TableSkeleton; "Failed to load roles" + Retry; "No roles found"; "Select a user to view and manage their role assignments."
```

---

## Audit Logs  `/audit-logs`
- **File:** `pages/AuditLogs.tsx` (hook `modules/hrms/api/useAudit.ts`)  ·  **Sidebar:** Settings scope › Audit Logs (`PLATFORM_ITEMS` audit / `SETTINGS_NAV` s-audit: OWNER, SUPER_ADMIN, COMPANY_ADMIN); ⌘K action "Audit Logs"  ·  **Roles:** RouteGuard anyOf `AUDIT_READ`.
- **Status:** LIVE — `useAuditEvents(filters)` → `GET /v1/audit/events?action&resource&actor&resourceId&from&to&page&size` (paged, `meta.total`). Export button deliberately removed (no endpoint).

### Purpose
Compliance / incident review: who did what, to which record, when, from which IP — with a diff. Admin-only.

### Layout (map to the design-system parts)
1. `HrPageHeader` crumb "Settings", title "System Audit Logs", subtitle "Track all user actions and system events", no actions.
2. Error `EmptyState` "Failed to load audit events" + Retry, else `TableCard` with `filters` (`FilterDef[]`): **All Actions** select (CREATE, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, ACCESS, PERMISSION_CHANGE) · **All Resources** select (EMPLOYEE, LEAVE REQUEST, ATTENDANCE, PAYROLL RUN, POLICY, DOCUMENT, EXPENSE CLAIM, USER, ROLE, COMPANY, DEPARTMENT, SETTINGS) · **Actor email** text (350ms debounce) · **Resource ID** text (debounced) · **From date** · **To date**; `footer` = `hrPaginationFooter` (page size default 25, changeable).
3. Body: 8 `Skeleton` rows while loading; empty "No audit events" + "Try adjusting your filters." / "Events will appear here once actions are recorded."; else `hr-table` columns **Timestamp** (`formatDistanceToNow` "3 hours ago") · **Actor** (email or userId) · **Action** (`HrStatusPill` ok CREATE / info UPDATE / red DELETE / warn EXPORT / gray others) · **Resource** (type + first 8 chars of id, hide < md) · **IP** (mono, hide < lg) · **Diff** ("View" link or —). Row click opens the drawer.
4. **Event Details** `Drawer`: label/value stack — Event ID (mono), Timestamp (`toLocaleString`), Actor, Action pill, Resource, Resource ID, IP Address, Trace ID; **Show diff ▼ / Hide diff ▲** toggling a pretty-printed JSON `<pre>`.

### Data shown
- `AuditEventDto`: `id`, `occurredAt`, `actorEmail`, `actorUserId`, `action`, `resourceType`, `resourceId`, `ip`, `traceId`, `diff` (JSON string). `meta.total` drives pages; `useClampedPage` pulls the page back into range.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| All Actions / All Resources | FilterBar | sets filter, resets page 0 | AUDIT_READ | LIVE |
| Actor email / Resource ID | FilterBar (text) | debounced filter | AUDIT_READ | LIVE |
| From date / To date | FilterBar (date) | ISO instant filter | AUDIT_READ | LIVE |
| Clear all | FilterBar default | one `onChange('')` per active filter | AUDIT_READ | LIVE |
| Row click / View | table | opens Event Details drawer | AUDIT_READ | LIVE |
| Show diff ▼ / Hide diff ▲ | drawer | toggles JSON diff | AUDIT_READ | LIVE |
| Page ‹ › / page size | TableCard footer | `setPage` / `setPageSize` | AUDIT_READ | LIVE |
| Retry | error EmptyState | `refetch()` | AUDIT_READ | LIVE |
| Export | — | **removed**: "no export endpoint — AuditController exposes only a paged GET /v1/audit/events" (file comment); `audit.export` permission still defined | — | DEAD (intentionally not rendered) |

### States
- loading skeleton rows; empty (two messages); error with Retry; no-permission → shell Access Restricted.

### Rules & permissions
- Resource types are an enumerated list because the API matches exact values. Dates converted to ISO instants. Tenant-scoped server-side.

### Gaps & plan  (keep / add / change)
- **Keep:** six filters, drawer with diff, honest removal of the fake Export. [BLUEPRINT §6 row 53] "Audit Logs — Strong — Partitioned — Surface in Settings" (done).
- **Add:** [code: comment in AuditLogs.tsx] build the export endpoint, then restore an **Export CSV** `HrButton` in `HrPageHeader.actions` gated by `audit.export`. [BLUEPRINT §27 P1] "rows-per-page + column visibility" — page size exists; column visibility does not.
- **Change:** Timestamp shows only relative time in the table — add the absolute "18 Sep 2026, 14:32" under it (tabular-nums). Diff column is a bare "View" text — make it `HrButton size=sm variant=ghost`. Actor shows raw userId when email is missing — resolve to a name via workspace users. Use `DataTable` instead of raw `hr-table`.

### Screenshot
`Attach: /audit-logs — current screen (and the Event Details drawer)`

### Claude Design prompt (ready to paste)
```
Design System Audit Logs for OWNER / COMPANY_ADMIN / SUPER_ADMIN. HrPageHeader crumb "Settings", title "System Audit Logs", subtitle "Track all user actions and system events", action HrButton "Export CSV" (disabled with tooltip "Export is coming soon" until the endpoint exists). TableCard with FilterBar: All Actions (CREATE, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, ACCESS, PERMISSION_CHANGE), All Resources (Employee, Leave request, Attendance, Payroll run, Policy, Document, Expense claim, User, Role, Company, Department, Settings), Actor email, Resource ID, From date, To date, "Clear all". DataTable columns: Timestamp ("3 hours ago" + "18 Sep 2026, 14:32" tabular-nums), Actor (HrAvatar "Admin User" sub "owner@ionora.in"), Action (HrStatusPill ok CREATE / info UPDATE / red DELETE / warn EXPORT / gray LOGIN), Resource ("EMPLOYEE · 9f2c1a7b…"), IP (mono 103.21.244.9), Diff (ghost sm "View"); footer HrPagination "1–25 of 1,240", page size 25/50/100. Row click → HrDrawer "Event Details": label/value rows Event ID, Timestamp, Actor, Action pill, Resource, Resource ID, IP Address, Trace ID; "Show diff ▼" revealing a JSON block. States: 8 skeleton rows; empty "No audit events — Try adjusting your filters." / "Events will appear here once actions are recorded."; error "Failed to load audit events" + Retry.
```

---

## Login  `/login`
- **File:** `core/auth/LoginPage.tsx`  ·  **Sidebar:** none (public route, outside the shell)  ·  **Roles:** unauthenticated visitors; `RouteGuard` redirects here with `returnUrl` state.
- **Status:** LIVE — `GET /v1/public/workspace-status` (branding + status), `POST /v1/canonical-auth/login` `{tenantId, email, password}`, SDK `loginWithCredentials`, `markWelcomeIntent()`, then `/`.

### Purpose
Sign in to a specific workspace on its own subdomain (`ionora.unifiedtree.com/login`). Without a subdomain the page only asks for the workspace name and hands off to the branded URL.

### Layout (map to the design-system parts)
1. Full-screen radiant emerald ground (`.ut-ground`).
2. Centred card (max-w 420, `bg-white/95`, rounded 24, shadow-2xl): workspace logo (`workspaceStatus.logoUrl`, max-h 48) or striped "Your logo" placeholder with camera icon; divider.
3. Warning strip "This workspace is pending approval." (when status ≠ ACTIVE); error strip (`error`).
4. Form A (no subdomain): label "Workspace", input "yourcompany" + suffix ".unifiedtree.com", helper "We'll take you to your workspace's sign-in page.", button **Continue →** / "Finding workspace…".
5. Form B (subdomain): Email ("you@company.com"), Password with **Reset Password** link → `/forgot-password` and eye toggle; button **Log in** / "Logging in…"; link "Don't have an account?" → `https://unifiedtree.com/signup`.
6. Divider; "Powered by **UnifiedTree**"; small "{subdomain}.unifiedtree.com" caption.

### Data shown
- `WorkspaceStatus`: `tenantId`, `subdomain`, `tenantName`, `status`, `logoUrl`, `activeModules`, `requestedModules`. `AuthResponse`: `accessToken`, `userId/employeeId`, `email`, `firstName`, `lastName`, `roles`, `permissions`.
- Query params `?email=` and `?workspace=` prefill.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Continue | workspace form | validates slug (`SLUG_RE`), `GET /v1/public/workspace-status` with `X-Tenant-Subdomain` → `window.location = https://{slug}.{host}/login`; error "No workspace called "{slug}". Check the name and try again." / "Enter your workspace name" / "Use just the workspace name, e.g. "ionora"" | public | LIVE |
| Show/Hide password | eye button | toggles input type | public | LIVE |
| Reset Password | password label | `Link` → `/forgot-password` | public | LIVE |
| Log in | submit | status ≠ ACTIVE → `/pending-approval`; else `POST /v1/canonical-auth/login` → SDK login → `/` (→ `/modules`) | public | LIVE |
| Don't have an account? | below form | external `unifiedtree.com/signup` | public | LIVE |
| Powered by UnifiedTree | footer | external `unifiedtree.com` | public | LIVE |

### States
- loading button labels; error strip (server message or "Unable to sign in"); pending-approval strip; logo vs placeholder.

### Rules & permissions
- Slug `^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$`. Login is canonical per tenant; non-ACTIVE workspaces are diverted. Branding logo comes from Settings › Branding. Concurrent same-account logins fixed server-side ([STATUS] "live-concurrent-login: three parallel sign-ins…").

### Gaps & plan  (keep / add / change)
- **Keep:** tenant-branded card, one canonical login, pending diversion, "Powered by" credit.
- **Add:** [code: SecurityTab] 2FA challenge on login once enrolment exists. Nothing else cited.
- **Change:** `returnUrl` passed by `RouteGuard` is never read — after login the user always lands on `/modules` instead of the page they asked for. Card uses Tailwind greys (`gray-200/50`) rather than tokens; input/button styles differ from Accept-Invite/Forgot/Reset cards — unify on `Field`/`Input`/`Button`.

### Screenshot
`Attach: /login — current screen (workspace subdomain variant)`

### Claude Design prompt (ready to paste)
```
Design the Login page (public). Radiant emerald full-bleed ground; centred white card 420px, rounded 24. Top: the tenant's uploaded logo (max 48px tall) or a striped "Your logo" placeholder with a camera icon; thin divider. Variant A (no subdomain): Field "Workspace" with input "yourcompany" + suffix chip ".unifiedtree.com", helper "We'll take you to your workspace's sign-in page.", full-width Button "Continue →". Variant B: Field Email "you@company.com"; Field Password with eye toggle and a right-aligned link "Reset Password"; full-width primary Button "Log in" (loading "Logging in…"); centred link "Don't have an account?". Strips above the form: amber "This workspace is pending approval." and red error e.g. "No workspace called "ionora". Check the name and try again." Footer: divider, "Powered by UnifiedTree" (emerald bold), caption "ionora.unifiedtree.com". Use Field/Input/Button tokens so it matches Accept Invite and Reset Password.
```

---

## Accept Invite  `/accept-invite?token=…`
- **File:** `pages/AcceptInvite.tsx` (api `modules/hrms/employees/api/useInvitation.ts`)  ·  **Sidebar:** none (public; linked from the invitation email sent by Users › Invite)  ·  **Roles:** invited, not-yet-activated users.
- **Status:** LIVE — `POST /v1/auth/accept-invite` `{token, password}` → SDK login → `/me`.

### Purpose
A newly invited employee sets a password and is logged straight into their self-service workspace.

### Layout (map to the design-system parts)
1. `bg-bg-base` page with an emerald blur blob; `ut-card ut-card-lg` max-w 420, p-10.
2. Brand row: "U" tile (#059669) + "UnifiedTree".
3. H1 "Set your password", copy "Create a password to activate your account and log in."; error strip.
4. Form: **New Password** (Lock icon, eye toggle, "Minimum 8 characters") + strength meter (Weak / Fair / Good / Strong — red/amber/blue/emerald bar); **Confirm Password**; button **Activate account** / "Activating account…".
5. Done state: ✓ "Account activated!" "Logging you in…" (auto-navigates to `/me` after 800 ms).
6. Missing token: "Invalid link — This invitation link is missing a token. Check the email you received."

### Data shown
- Token from query; `AcceptInviteResponse` (`accessToken`, `userId`, `email`, `firstName`, `lastName`, `roles`, `permissions`, `tenantId`, `tenantSlug`, `tenantName`, `activeModules`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Show/Hide password | New Password | toggles type (`aria-pressed`) | public | LIVE |
| Activate account | submit | client checks match + ≥ 8 chars → `POST /v1/auth/accept-invite` → `loginWithCredentials` → `/me` | public | LIVE |

### States
- error "Passwords do not match" / "Password must be at least 8 characters" / server message; done; invalid link; loading.

### Rules & permissions
- Token single-use server-side; min 8 chars; strength score = length ≥ 8, uppercase, digit, symbol.

### Gaps & plan  (keep / add / change)
- **Keep:** strength meter, auto-login on success.
- **Add:** none cited.
- **Change:** invalid-link state has no way out (no link to Login or "request a new invite") — Reset Password's invalid state does have one; align. Lands on `/me` even for admin invitees who have no ESS permission — send to `/` (role-aware) instead. Brand row uses a hard-coded "U" tile instead of the tenant logo shown on Login.

### Screenshot
`Attach: /accept-invite?token=… — current screen`

### Claude Design prompt (ready to paste)
```
Design Accept Invite (public). Same card frame as Login (420px white card on the emerald ground, tenant logo or "Your logo" placeholder). H1 "Set your password", copy "Create a password to activate your account and log in." Fields: New Password (Lock icon, eye toggle, placeholder "Minimum 8 characters") with a 4-step strength bar labelled Weak / Fair / Good / Strong; Confirm Password. Primary Button "Activate account" (loading "Activating account…"). Error strip "Passwords do not match". Success state: check icon, "Account activated!", "Logging you in…". Invalid-token state: "Invalid link — This invitation link is missing a token. Check the email you received." with links "Back to login" and "Ask your admin to resend the invitation".
```

---

## Forgot Password  `/forgot-password`
- **File:** `pages/ForgotPassword.tsx`  ·  **Sidebar:** none (public; from Login "Reset Password", Settings › Security also calls the same endpoint)  ·  **Roles:** public.
- **Status:** LIVE — `POST /v1/auth/forgot-password` `{email}` (tenant from `X-Tenant-Subdomain`); always shows success.

### Purpose
Request a password-reset email.

### Layout (map to the design-system parts)
1. `ut-card ut-card-lg` max-w 420 on `bg-bg-base`; brand row "U" + "UnifiedTree".
2. H1 "Forgot password?", copy "Enter your email and we'll send a reset link."; error strip (never populated — catch shows success).
3. Field **Email Address** (Mail icon, "you@company.com"); button **Send reset link** / "Sending…"; link "Back to login".
4. Sent state: mint Mail tile, "Check your inbox", "If an account exists for **{email}**, a password reset link has been sent. Check your spam folder if you don't see it.", link "Back to login".

### Data shown
- none beyond the typed email.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Send reset link | submit | `forgotPassword(email)` → sent state (also on error, anti-enumeration) | public | LIVE |
| Back to login | form / sent state | `Link` → `/login` | public | LIVE |

### States
- loading; sent. No error state is ever shown by design.

### Rules & permissions
- Does not reveal whether the address exists.

### Gaps & plan  (keep / add / change)
- **Keep:** non-committal success copy.
- **Add:** none cited.
- **Change:** brand row should show the tenant logo like Login; card styles should share one auth template.

### Screenshot
`Attach: /forgot-password — current screen`

### Claude Design prompt (ready to paste)
```
Design Forgot Password (public) on the shared auth card. H1 "Forgot password?", copy "Enter your email and we'll send a reset link." Field "Email Address" with Mail icon, placeholder "you@company.com"; primary Button "Send reset link" (loading "Sending…"); text link "Back to login". Sent state: mint circle with Mail icon, H2 "Check your inbox", copy "If an account exists for priya.nair@ionora.in, a password reset link has been sent. Check your spam folder if you don't see it.", link "Back to login".
```

---

## Reset Password  `/reset-password?token=…`
- **File:** `pages/ResetPassword.tsx`  ·  **Sidebar:** none (public; from the reset email)  ·  **Roles:** public.
- **Status:** LIVE — `POST /v1/auth/reset-password` `{token, password}`.

### Purpose
Set a new password from an emailed token, then go to Login.

### Layout (map to the design-system parts)
1. Shared auth card; brand row.
2. H1 "Set new password", copy "Choose a new password for your account."; error strip.
3. **New Password** (Lock, eye, "Minimum 8 characters"), **Confirm Password**; button **Update password** / "Updating…".
4. Done: ✓ "Password updated!" "You can now log in with your new password." button **Go to login →**.
5. Missing token: "Invalid link — This reset link is missing a token." link "Request a new reset link →" → `/forgot-password`.

### Data shown
- token from query.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Show/Hide password | New Password | toggles type | public | LIVE |
| Update password | submit | match + ≥ 8 check → `POST /v1/auth/reset-password` → done | public | LIVE |
| Go to login → | done state | `Link` → `/login` | public | LIVE |
| Request a new reset link → | invalid state | `Link` → `/forgot-password` | public | LIVE |

### States
- error "Passwords do not match" / "Password must be at least 8 characters" / server; done; invalid link; loading.

### Rules & permissions
- Token expiry enforced server-side; min 8 chars.

### Gaps & plan  (keep / add / change)
- **Keep:** invalid-link recovery link.
- **Add:** none cited.
- **Change:** no strength meter here while Accept Invite has one — share the component. Eye toggle lacks the `aria-label` Accept Invite has.

### Screenshot
`Attach: /reset-password?token=… — current screen`

### Claude Design prompt (ready to paste)
```
Design Reset Password (public) on the shared auth card. H1 "Set new password", copy "Choose a new password for your account." Fields New Password (Lock icon, eye toggle, "Minimum 8 characters", with the same Weak/Fair/Good/Strong strength bar as Accept Invite) and Confirm Password; primary Button "Update password" (loading "Updating…"); error strip "Passwords do not match". Done state: check icon, "Password updated!", "You can now log in with your new password.", primary Button "Go to login →". Invalid-token state: "Invalid link — This reset link is missing a token." + link "Request a new reset link →".
```

---

## Workspace Pending Approval  `/pending-approval`
- **File:** `pages/PendingApproval.tsx`  ·  **Sidebar:** none (public; Login redirects here when `workspace-status.status !== 'ACTIVE'`)  ·  **Roles:** public.
- **Status:** LIVE — `GET /v1/public/workspace-status` on load and on Refresh.

### Purpose
Tell a new workspace's owner that a UnifiedTree administrator still has to approve the requested modules; let them re-check.

### Layout (map to the design-system parts)
1. Mint page (`#ECFDF5`), `ut-card ut-card-lg` max-w 3xl p-8.
2. Brand row (logo image `/assets/unifiedtree-logo.png` + "UnifiedTree"); Clock tile; eyebrow "WORKSPACE PENDING APPROVAL"; H1 "UnifiedTree administrator approval is required."; copy "Your workspace has been reserved, but module dashboards remain locked until the administrator approves the requested modules manually."
3. Inner `ut-card`: "WORKSPACE" `{subdomain}.unifiedtree.com` (or "Loading workspace..."), grid **Status** `{status}` / **Requested modules** `{requestedModules.join(', ')}` or "-".
4. Buttons: **Refresh status** (RefreshCcw) · **Back to login**.

### Data shown
- `WorkspaceStatus.subdomain`, `status`, `requestedModules`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Refresh status | footer | re-fetch `GET /v1/public/workspace-status` | public | LIVE |
| Back to login | footer | `Link` → `/login` | public | LIVE |

### States
- loading "Loading workspace..." / "Loading"; unknown "Unknown"; no error handling (fetch failure leaves the last state).

### Rules & permissions
- Approval is manual by the platform super-admin (separate auth surface — [STATUS] "PLATFORM_SUPER_ADMIN has a separate authentication surface").

### Gaps & plan  (keep / add / change)
- **Keep:** clear status + requested modules; refresh.
- **Add:** none cited.
- **Change:** if the status flips to ACTIVE after Refresh the page does not redirect to `/login` — do so. Heavy `font-black` typography is off-system; use the auth card scale. Add an error state for a failed fetch.

### Screenshot
`Attach: /pending-approval — current screen`

### Claude Design prompt (ready to paste)
```
Design Workspace Pending Approval (public) on a mint canvas with one wide white card. Brand row, Clock icon tile, eyebrow "WORKSPACE PENDING APPROVAL", H1 "UnifiedTree administrator approval is required.", copy "Your workspace has been reserved, but module dashboards remain locked until the administrator approves the requested modules manually." Inner card: label "Workspace" value "ionora.unifiedtree.com"; two columns Status "PENDING_APPROVAL" (HrStatusPill warn "Pending approval") and Requested modules "HR & Payroll, CRM & Sales". Buttons: primary "Refresh status" with refresh icon, outline "Back to login". Add a subtle "Last checked 14:32" caption and, when the status becomes Active, a success state "Your workspace is approved — Go to login".
```

---

## No Access / Access Restricted  `/no-access` (+ inline `RouteGuard` fallback)
- **File:** `pages/NoAccess.tsx`; inline `NoAccess()` in `routes/RouteGuard.tsx`; `EmptyState variant="forbidden"` in `pages/Users.tsx`  ·  **Sidebar:** none (`RoleAwareLanding` sends users with zero roles here; the inline variant renders inside the shell on any guarded route)  ·  **Roles:** authenticated users with no roles / missing permission.
- **Status:** LIVE — static copy + `logout()`.

### Purpose
Dead-end with a clear next step when an account has no roles (full page) or lacks a permission for a route (inline inside the shell).

### Layout (map to the design-system parts)
1. `/no-access`: centred column — ShieldOff tile, H1 "No roles assigned", copy "Your account has no roles assigned. Contact your administrator to get access.", primary button **Sign out**.
2. Inline route fallback: 🔒 emoji, H2 "Access Restricted", copy "You do not have the required permissions to view this page. Contact your administrator if you believe this is a mistake." — no button.
3. Users page fallback: `EmptyState forbidden` "Access restricted — You don't have permission to manage workspace users."

### Data shown
- none.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Sign out | `/no-access` | SDK `logout()` | all | LIVE |

### States
- single static state each.

### Rules & permissions
- `/no-access` is public-routed but reached only via redirect; the inline variant is chosen by `RouteGuard anyOf`.

### Gaps & plan  (keep / add / change)
- **Keep:** plain wording; Sign out on the roles-less page. [BLUEPRINT §7 ESS rule] "an employee must never see an empty admin screen or a 403" — the inline fallback is the safety net.
- **Add:** none cited.
- **Change:** three different forbidden treatments (page, inline emoji block, `EmptyState forbidden`) — use `EmptyState variant="forbidden"` everywhere with a "Back to dashboard" action on the inline variant. Replace the 🔒 emoji with the lucide `Lock` icon.

### Screenshot
`Attach: /no-access — current screen (and any guarded route as EMPLOYEE for the inline variant)`

### Claude Design prompt (ready to paste)
```
Design two forbidden states. (1) Full page "/no-access": centred EmptyState with ShieldOff icon, title "No roles assigned", copy "Your account has no roles assigned. Contact your administrator to get access.", primary Button "Sign out". (2) Inline inside the shell for a guarded route: EmptyState variant forbidden with Lock icon, title "Access Restricted", copy "You do not have the required permissions to view this page. Contact your administrator if you believe this is a mistake.", ghost Button "Back to dashboard". Same component, same spacing, on the light canvas.
```

---

## Placeholders: ComingSoon · ModuleComingSoon · ModuleNotActivated  `/accounting`, `/accounts/*`, `/crm`, `/crm/*`, `/projects`, `/projects/*`, `/inventory`, `/purchase`, `/procurement`, `/sales`, `/manufacturing`, `/pos`, `/reports`, `/analytics`, `/files`, `/hrms/soon/:key` (`/payroll` is a plain redirect to `/hrms/payroll-dashboard`)
- **File:** `shared/components/ComingSoon.tsx`, `shared/components/ModuleComingSoon.tsx`, `pages/ModuleNotActivated.tsx`, `shared/components/ModuleGate.tsx`, `ComingSoonRoute` in `App.tsx`  ·  **Sidebar:** non-HRMS groups in `MODULE_ITEMS` (CRM › Leads/Customers/Deals; Accounts › Invoices/Payments/Expenses; Payroll; Projects › All Projects/Task Board; Inventory; Procurement) appear only when the workspace owns that module; `/analytics`, `/files`, `/hrms/soon/:key` have no sidebar entry  ·  **Roles:** `ComingSoonRoute`: module active → ComingSoon for everyone; inactive + admin (`useRoles.ADMIN_ROLES` = OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN) → `ModuleGate` falls through to ModuleNotActivated; inactive + non-admin → redirect `/dashboard`. `/analytics` and `/files` are auth-only (no gate). `/hrms/soon/:key` is behind `ModuleGate moduleKey="hrms"`.
- **Status:** STUB by design — static placeholder screens; `ModuleGate` renders `null` until SDK status is `authenticated`.

### Purpose
Keep every sellable route navigable without a 404: tell the user the module is in their plan but not built (ComingSoon), that an HR screen is being built (ModuleComingSoon), or that the module is not in the plan and can be activated (ModuleNotActivated upsell).

### Layout (map to the design-system parts)
1. **ComingSoon** (min-h 60vh centred): icon tile from `MODULE_META` (Payroll CreditCard, Accounting Calculator, Inventory Boxes, CRM TrendingUp, Purchase ShoppingCart, Sales Tag, Projects FolderKanban, Manufacturing Factory, POS Store, Reports BarChart3; fallback Clock), H2 "{Module} is part of your plan", eyebrow "LAUNCHING SOON", copy "This module is launching soon. We are putting the finishing touches in place — you will be able to start using {Module} here once it goes live.", outline button **← Back to dashboard**.
2. **ModuleComingSoon** (`/hrms/soon/:key`, max-w 2xl): "← Back" (history), `ut-card ut-card-lg` centred — Hammer tile, H1 `SOON[key].title` (28 keys, e.g. "Attendance Analytics", "Appraisals & 360° Feedback", "POSH Case Management"), desc, chip "Being built — coming soon". Unknown key → redirect `/dashboard`.
3. **ModuleNotActivated** (min-h 60vh): Lock tile (emerald-50), H2 "{Module} Not Activated" (`MODULE_LABELS` covers only hrms / crm / accounts / payroll / inventory / procurement / projects / helpdesk / analytics — the route keys `accounting`, `purchase`, `sales`, `manufacturing`, `pos`, `reports` fall back to the raw lowercase key, e.g. "accounting Not Activated"), copy "The {Module} module is not included in your current plan. Activate it to unlock all features.", price line **"Starting at ${price}/month"** (hard-coded USD map: hrms 49, crm 39, accounts 59, payroll 45, inventory 35, procurement 35, projects 29, helpdesk 29, analytics 39; default 29), primary **✨ Activate {Module} →** and outline **Back to Dashboard**.

### Data shown
- none from the API; module key from the route; `tenant.activeModules` for the gate.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Back to dashboard | ComingSoon | `Link` → `/dashboard` | all | LIVE |
| ← Back | ModuleComingSoon | `navigate(-1)` | all | LIVE |
| Activate {Module} → | ModuleNotActivated | `navigate('/plan')` | admins (page only shown to admins) | LIVE |
| Back to Dashboard | ModuleNotActivated | `navigate('/')` (→ `/modules`) | admins | LIVE |
| Sidebar children (Leads, Invoices, Task Board…) | shell | route → ComingSoon for the module | owners of the module | STUB destination |

### States
- ModuleGate `null` while auth hydrates (avoids flashing the upsell); unknown `/hrms/soon/:key` → `/dashboard`.

### Rules & permissions
- Non-admins never land on a locked module route. Allow-listed keys only for ModuleComingSoon.

### Gaps & plan  (keep / add / change)
- **Keep:** honest "Launching soon" messaging; gate ordering; allow-list.
- **Add:** [BLUEPRINT §6 row 61 / §6.1] Projects & Productivity and other unsold SKUs remain ComingSoon — product decision, not UI. Many `SOON` keys already have live screens (Attendance Analytics, Shifts & Overtime, Hiring Pipeline, Payroll Dashboard, Statutory Compliance…) — prune the map to keys that are actually unbuilt.
- **Change:** ModuleNotActivated prices are USD and hard-coded ("Starting at $49/month") while pricing is per-user ₹ from `module_plans` ("HR is ₹39/user/month" — Settings.tsx BillingTab comment) — read the price from `useModulePlans` or drop the line. [code: `App.tsx` `/procurement` → `ComingSoonRoute moduleKey="purchase"` vs `PlatformShell.tsx` sidebar item `module: 'procurement'`] the sidebar shows Procurement when the tenant owns `procurement`, but the route gates on `purchase`, so an owner of `procurement` lands on "purchase Not Activated" — use one key. [code: `ModuleNotActivated.MODULE_LABELS`] add the six missing sellable keys so titles are never lowercase raw keys. Sidebar exposes CRM/Accounts/Projects sub-items (Leads, Invoices, Task Board) that all resolve to the same placeholder — collapse to a single module entry until built. Three placeholder components with different visual grammar — unify on `EmptyState` with an icon, title, description and one action ([BLUEPRINT §24.5] mandatory states on every screen).

### Screenshot
`Attach: /crm/leads — current screen (ComingSoon) and /accounting as admin without the module (ModuleNotActivated)`

### Claude Design prompt (ready to paste)
```
Design one placeholder pattern built on EmptyState, used in three variants inside the shell. (1) "Launching soon": module icon (TrendingUp for CRM), title "CRM & Sales is part of your plan", eyebrow "LAUNCHING SOON" in emerald, copy "This module is launching soon. We are putting the finishing touches in place — you will be able to start using CRM & Sales here once it goes live.", outline Button "← Back to dashboard". (2) "Being built" for an HR screen: Hammer icon, title "Appraisals & 360° Feedback", copy "Review cycles with manager and peer feedback.", mint chip "Being built — coming soon", ghost "← Back". (3) "Not activated" upsell for admins only: Lock icon in a mint tile, title "Accounting Not Activated", copy "The Accounting module is not included in your current plan. Activate it to unlock all features.", price line from the catalog "₹49/user/month" (never USD), primary Button "Activate Accounting →" (goes to Manage plan), outline "Back to apps". All three: centred, max-w-md, on the light canvas, same spacing.
```

---

## Module Workspace showcase  `/module-workspace`
- **File:** `pages/ModuleWorkspace.tsx` (1,484 lines, recharts + `HrTabs`)  ·  **Sidebar:** none  ·  **Roles:** n/a — route redirects.
- **Status:** DEAD — `App.tsx` line 192: `<Route path="/module-workspace" element={<Navigate to="/dashboard" replace />} />`; the lazy import (`App.tsx:108`) is declared but never rendered. Comment: "REDIRECTED 2026-08-10: the page ships fabricated employees, invented KPIs (Rs 4.82 Cr) and a made-up 'Acme Manufacturing' company under the signed-in user's own login… The file stays on disk so the design work isn't lost… Delete the file (and this route) entirely when a real replacement lands."

### Purpose
A presentational prototype of the dark-rail + top-bar + sub-tab shell with dummy dashboard charts. Not a product screen.

### Layout (map to the design-system parts)
- Self-contained chrome (dark emerald icon rail, sticky top bar, `HrTabs` sub-tab row with slide transitions) over dummy KPI cards and recharts Area/Bar/Pie charts using the `.mw-scope` CSS token ramp (#04503A · #059669 · #34D399 · amber #FBBF24).

### Data shown
- All hard-coded dummy data (no API calls, no stores).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| — | — | route redirects to `/dashboard`; nothing reachable | — | DEAD |

### States
- n/a.

### Rules & permissions
- n/a.

### Gaps & plan  (keep / add / change)
- **Keep:** nothing user-facing. Its chart colour policy comment (validated ΔE pairs, amber accent) is reusable guidance for dashboards.
- **Add:** [BLUEPRINT §27 P0-10 "Stop editing dead shell — Delete" / §5.1] and [code: App.tsx comment] delete the file and the route when the real dashboard lands.
- **Change:** n/a — do not design this screen.

### Screenshot
`Attach: none — route redirects to /dashboard`

### Claude Design prompt (ready to paste)
```
Do not design this page. It is a dead prototype (redirected to /dashboard) with fabricated data. If any of it is wanted, reuse only its chart colour rule: single-hue emerald ramp #04503A · #059669 · #34D399 for stacks, #04503A · #10B981 · #A7F3D0 · #FBBF24 for donuts, amber #FBBF24 as the one contrast accent, with legends carrying visible values.
```
