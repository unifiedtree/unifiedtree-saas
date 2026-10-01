# Phase 0 audit: app shell, navigation and homes

Area: rail, top bar, Pages panel, More panel, ⌘K search, notifications, navigation model, which Home each person gets.
Repo: `C:\REACT\unifiedtree-saas`, `main` at `e32a4dc6`. Read-only audit. No repo file was changed.

## 0. How this was checked

Read in full: the handoff `README.md`, `CLAUDE_CODE_PROMPT.md`, `redesign/DECISIONS.md`; prototype `HrmsPlatform.dc.html`, `hrms-core.js`, `UtMore.dc.html`, `UtSearch.dc.html`, `UtSections.dc.html` (+ `UtSection`), `SavedHeaderTiles.dc.html`, `saved-designs.md`, `ReviewBoard.dc.html`, `PgGeneric.dc.html`, the logic class of `EmpHome.dc.html`.
Repo: `layouts/PlatformShell.tsx`, `layouts/railLit.ts` (+ test), `layouts/appConfig.tsx`, `design/shell/ShellChrome.tsx` + `shell.css`, `shared/navigation/pageRegistry.ts` / `access.ts` / `useAccess.ts` (+ test), `shared/components/TopBarSearch.tsx`, `GlobalSearch.tsx`, `CommandPalette.tsx`, `NotificationPanel.tsx`, `shared/search/*`, `core/notifications/notificationStore.ts` + `NotificationProvider.tsx`, `App.tsx`, `modules/hrms/HrmsDashboard.tsx`, `dashboard/AdminDashboardContainer.tsx`, `design/module/ModuleKit.tsx`, `providers/ThemeProvider.tsx`, `core/tenant/workspaceBranding.ts`, `shared/hooks/useRoles.ts`, `useDisplayName.ts`, `greetingName.ts`, `pages/Settings.tsx`, `pages/Profile.tsx`, `pages/Modules.tsx`; backend `NotificationsController`, `NotificationDtos`, `AppNotificationType`, `NotificationEventCatalog`, `AppNotification` (entity), `SearchController`, `GlobalSearchController/Access/Service`, `EmployeeSearchDtos`, `DashboardSummaryController`, `AttendanceController#dashboard`; canonical migrations V004, V026, V037, V065, V084, V112, V117, V129, V143_4, V143_17, V143_26; `docs/Designs/STATIC-UI-TO-BUILD.md` §1, §2, §11.1–11.6, §11.18, §11.20; the live tests listed in §9.

**The local API (8080) and the recovery database (55432) were not running during this audit.** Role → permission facts below come from the canonical migrations and the code, not from a live `/v1/auth/me`. Admins can change role permissions in the product, so re-check `mgr@`, `hrm@`, `fin@`, `reader@` with `GET /v1/auth/me` (or `rbac.role_permissions`) before building the Home rule.

---

## 1. Summary

1. Today's shell (desktop): an 88 px dark-green rail with icon + short label under each icon (Keka style), unlabeled divider blocks, HR Setup pinned at the bottom, a **green** 64 px header with an inline search field, Settings gear, All apps, bell (dot only) and a profile button/menu (My Profile, My Apps, Settings, Sign out). A group's pages show as a white underline tab row under the header; a page's own tabs live inside the page.
2. The design replaces all of that: a 72 px rail that expands to 248 px on hover (pin keeps it open and pushes content), **named groups**, a **More** button with an overflow badge, a 248 px **Pages panel**, a **white** header with the page's tabs as outlined pills, a search pill that opens one ⌘K dialog, and a bell with a count. Profile, settings entry, theme switch and Sign out move into the More panel. The header gear, All apps button and profile menu disappear.
3. Menus are already permission-only (`menuRule()` + `accessState()` in `pageRegistry.ts`/`access.ts`, 25 Sep). The design's grouping can be laid over the same menu items, paths and rules without changing any URL or permission. **Recommendation (a): follow the design's grouping** as a presentation layer (details and every page that moves in §4).
4. **Which dashboard someone gets is decided by role names today, not a permission:** `HrmsDashboard` shows the admin dashboard when `useRoles().isEmployee` is false (any of OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, HR_MANAGER, HR, DEPT_MANAGER, MANAGER, FINANCE_LEAD). Custom roles always get the old staff dashboard. **Recommendation (b):** admin dashboard for people holding any company-wide read (`hrms.employee.read`, `payroll.runs.read`, `org.company.write`, any `hrms.report.*`), self-service Home at `/me` for everyone else, and team blocks and My team for team approvers. Under the default role seeds, only **department managers** (DEPT_MANAGER/MANAGER) move off the admin dashboard; plain employees move from the old staff dashboard to the new Home. Details in §5.
5. The data the shell shows almost all exists: menu rules, branding, current user, notifications (list, unread count, mark read, mark all read), people search, global record search, the page registry and the quick-action registry. Backend gaps are small, and **none needs a schema change**: a `group` field on notifications (the catalog already has it), an optional `since` filter, extra person facts in `/v1/search`, a Help & support endpoint, and optionally a holiday search type and new notification events.
6. The largest frontend jobs: moving every page's tab bar into the shell header (ModuleKit `Views`, the generated designed pages' own section bars, the settings tabs), dark mode (the ThemeProvider forces light; about 4,245 hex colour literals in 242 source files), and the font (Inter is hard-coded in the chrome/kit; 284+ weight-700/800 usages).
7. Conflicts with earlier client decisions: the header gear and profile menu were restored on 26 Sep (the design removes them), managers were given the admin dashboard on 25 Sep (the design gives them the self-service Home), the white-label rule forbids the rail's "UnifiedTree HRMS" sub-line, and the launcher (`/modules`, the post-login landing) has no entry point in the design.
8. At least six live tests assert today's shell markup and will fail once the shell changes (`live-rail-highlight`, `live-navigation`, `live-settings-restored`, `live-w3-search`, `live-w3-greeting-myatt`, `live-staff-dashboard`), and about 20 more read page tab bars that the header would take over (§9).

---

## 2. Shell screens

Status words: **exists** = shipped and backed by real data; **partial** = exists with a stated gap; **missing** = not built. "Frontend only" means no API is involved.

### 2.1 Rail

- **Prototype:** `HrmsPlatform.dc.html` lines 13–23 (`<aside aria-label="Main navigation">`), `hrms-core.js` `GROUPS`, `RGROUPS`, `modsFor`, `fit()`, `observe()`, `vals().groups/item/go`; config `HP_CFG = { itemH: 40, gap: 2, groupH: 24, P: 248 }`.
- **Repo:** `layouts/PlatformShell.tsx` (`NAV_ITEMS` L66–73, `MODULE_ITEMS` L98–262, `isVisible` L456–462, `railItems` L502–529, `RAIL_LABELS` L302, `RAIL_ICONS` L332, `RAIL_DIVIDERS` L340, `railEntry` L676–685, `railTop/railBottom` L686–687), `design/shell/ShellChrome.tsx` (`DesignRail`, `RailButton`, `BrandMark`), `design/shell/shell.css`, `layouts/railLit.ts`. Rendered on every route inside `<PlatformShell>` (App.tsx L196–891); the launcher `/modules` uses a transparent header and no rail.

| | Today | Design |
|---|---|---|
| Width | Fixed 88 px (`DesignRail`), buttons 72×54, icon above a one-word label. No collapse (the preference was removed 22 Aug, PlatformShell L37–44). | 72 px collapsed, icons only, labels clipped. Hover expands to 248 px as an overlay (content is not pushed). Pin keeps it at 248 and pushes content. While the Pages panel is open the pinned rail stays at 72. While More is open, hover does not expand it. |
| Top block | Workspace mark (uploaded mark/logo or monogram) + workspace name; click → `/dashboard`. | 40 px white monogram tile with a gold dot, company name, sub-line "UnifiedTree HRMS", pin button ("Keep sidebar open" / "Collapse sidebar"). Not clickable. |
| Items | Top-level groups in a fixed order with unlabeled dividers above Company, Attendance, Payroll, Performance; HR Setup pinned in a bottom slot. Scrolls when too tall. | Named groups with a 24 px separator (short line when collapsed, uppercase label when expanded), 40 px items with radius 10. Active item is white with brand text and a chevron if the module has several pages. Business apps show a "Soon" badge. |
| Overflow | The list scrolls. | Items that don't fit move to the More panel. More shows "+N" (and a gold dot when collapsed). |
| Bottom | HR Setup | **More** button. Lit when the panel is open, when the current module is in the overflow, or on a settings page. |

**Data points**

| # | Data point | Source today | Status |
|---|---|---|---|
| 1 | Workspace mark (uploaded mark/logo, else monogram) | `useWorkspaceBranding()` ← `GET /v1/workspace/branding` | exists |
| 2 | Company/workspace name | `useWorkspaceBranding().workspaceName` | exists |
| 3 | Sub-line under the name ("UnifiedTree HRMS") | none | **conflict**: white-label rule (`workspaceBranding.ts`: people inside a workspace never see the vendor's name). Use a neutral line (e.g. "HRMS") or none |
| 4 | Items the viewer may open (label, icon) | `isVisible()` → `menuRule(path, group)` → `accessState()` over `useAccessContext()` (SDK permissions, `tenant.activeModules`, JWT `employee_id`, admin/plan-admin role flags) | exists. Labels, order and grouping change |
| 5 | Group labels (Home, My team, My work, People, Time, Pay & benefits, Org & policy, Insights, Business apps) | none (dividers only) | missing. Copy only, no data |
| 6 | Lit item | `railLit.litRailKey()` + `railVia` (sessionStorage `ut:rail-via`) | exists. Must learn the new module keys |
| 7 | "Has pages" chevron | `children.length > 1` | exists |
| 8 | "Soon" badges (Business apps) | `useModulePlans()` ← `GET /v1/public/module-plans` (status `LAUNCHING_SOON`) | partial: not in the HRMS rail today, only in the launcher |
| 9 | More lit state | none (the header gear is lit on settings pages, class `ds-hdr-active`) | missing |
| 10 | More "+N" badge and dot | none | missing (frontend only: overflow count) |
| 11 | Pin state | none | missing (frontend only, per viewer: use a new localStorage key, not the retired `sidebar-collapsed:*`) |

**Actions**

| Action | Today | Status |
|---|---|---|
| Click an item | `rememberRail(key, target)` + `navigate(first visible child)` | partial: the design also returns to the last page used in that module (`last[mk]`, default for Workforce = directory) and opens the Pages panel for multi-page modules |
| Hover / focus to expand | none | missing (add `:focus-within` so keyboard users get labels too; touch devices rely on pin) |
| Pin / collapse | none | missing |
| More | none | missing |
| Top block click | `navigate('/dashboard')` | exists (not clickable in the design; recommend keeping it as Home, or making it the way back to `/modules`, see §10) |
| Preload page code on hover | `preloadPath()`; idle preload of every reachable page | exists, keep |

**Permissions:** each link's rule (full table in §3): `MENU_RULES[group:path]` or `MENU_RULES[path]`, else the registry entry for the path (`pageRegistry.ts` L287–311). The self-service group is hidden for `ADMIN_ROLES` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN): `if (group === 'ess' && administersWorkspace) return false` (L457). Links the registry doesn't know (business apps) show only to plan admins (`accessCtx.planAdmin`: OWNER, SUPER_ADMIN, COMPANY_ADMIN or the `*` wildcard).

### 2.2 Pages panel and the "Pages" button

- **Prototype:** `HrmsPlatform.dc.html` L24–27 (panel), L31 (`showPanelBtn` button); `hrms-core.js` `vals()` → `pages`, `panelOn`, `pushOn`, `openPanel/closePanel`, `go(..., rail=true)`.
- **Repo:** no panel. Closest: `DesignSubNav` (ShellChrome) fed by `sectionTabs` (PlatformShell L690–714), a white underline tab row of the lit rail item's pages (aria-label "`<Group> sections`"). It is hidden on pages that draw their own section bar (`OWN_SECTION_BAR` L342–349: Attendance, Payroll, Master pages, employee workspace). On settings routes the row lists `SETTINGS_NAV`.
- **Design behaviour:** a 248 px panel right of the rail opens when a multi-page module is clicked in the rail. Header: module icon tile, module name, "N pages", "Hide pages". Rows: page name, number of tabs, active row brand-soft with a 3 px bar. When hidden, the header shows a "Pages" button labelled with the module name ("Show pages").

| Data point | Source | Status |
|---|---|---|
| Module icon and name | nav item | exists |
| "N pages" | count of the module's visible pages (`isVisible`) | exists (derived) |
| Page names | nav children labels | exists |
| Tab count per page | registry tab entries (`tab()` in `pageRegistry.ts`) filtered by `accessState` | partial: the registry's tab lists must match each page's real tabs (it lacks e.g. directory status tabs, Workforce analytics tabs) |
| Active page | longest `matchPath` (as `sectionTabs` does) | exists |

| Action | Status |
|---|---|
| Open a page | exists (`navigate(child.path)`) |
| Hide pages / Show pages (header button) | missing (frontend only) |
| Auto-open on a rail click | missing (frontend only) |

### 2.3 Top bar

- **Prototype:** `HrmsPlatform.dc.html` L29–42; `hrms-core.js` `vals()` (`tabs`, `hasTabs`, `noTabs`, `pageLabel`, `dashPills`, `hasQ/qLabel/clearQ`, `unread`); dashboard pills = `DASH_SECS`. The "Viewing as" button (L37) and role menu (L75) are **not shipped**.
- **Repo:** `DesignHeader`, `HeaderIconButton`, `HeaderBellButton`, `HeaderProfileButton` (ShellChrome), PlatformShell L745–763; `TopBarSearch.tsx`; page tabs are inside each page (`ModuleKit.Views` → `SubTabs` with `role=group aria-label="<X> views"` and `aria-pressed`; `AttendancePage` TABS; `PayrollModule` sections; Master `NAV`; Settings tabs).
- **Design:** 64 px, white, inset bottom hairline, padding `0 16px 0 24px`. Left: Pages button, then outlined pill tabs (40 px, radius 999, active solid `#0F6E56` with the active-pill shadow, horizontal scroll with a right fade mask) or, for a page with no tabs, one solid pill with the module icon and page name. On the dashboard: section pills with icons (Header A). Right: the filter chip (only when a search "filter this page" is active), the search pill (green icon, "Search" + rotating words, ⌘ K keys), the bell with a count badge.

| Data point | Source today | Status |
|---|---|---|
| Pages button label | module label | exists (new placement) |
| Pill tabs (labels, active tab) | each page (`?tab=`/`?view=` via `useView`, `AttendancePage`, `PayrollModule`, Master, Settings) | partial: the tabs exist, but inside pages. The header needs a shell tab registry (new) |
| Tab counts (e.g. Leave → Approvals waiting) | pages (`ViewTab.count/urgent`) | exists today, **not in the design pills**: keep them (§7) |
| Single pill (module icon + page name) | `pageLabel` (same source as `usePageTitle`) | exists |
| Dashboard section pills (Overview, Attendance, Upcoming, People, Hiring & projects, Payroll & activity) | `AdminDashboardContainer` `show` flags (each section gated by its endpoint's permission) | partial: sections and their gates exist; the pills and scroll-to are new |
| Filter chip ("x" + clear) | none | missing (needs pages that read `?q=`, §2.6) |
| Search pill rotating words | none (static placeholder "Search people, leave, payslips, documents, pages…") | missing. Words must follow permissions (a person only with `hrms.employee.read`, a payslip only with payslip reach, a report only with report permissions…) |
| Shortcut keys | `TopBarSearch` `SHORTCUT` (⌘K on Mac, Ctrl K elsewhere) | exists |
| Bell unread count | `useNotificationStore.unreadCount()` ← `GET /v1/notifications/unread-count` (polled every 5 min and on focus by `NotificationProvider`) | exists (today renders a dot, not the number) |

| Action | Status |
|---|---|
| Pages button | missing |
| Tab click (URL param) | exists in pages; moves to the header |
| Dashboard section pill → scroll to section | missing (dashboard audit) |
| Filter chip clear | missing |
| Search pill click / ⌘K / Ctrl+K | exists (opens the "Advanced search" palette; the inline field opens its own dropdown) |
| Bell | exists |

Removed from the header by the design: Settings gear (L748–752), All apps (L753), profile button and menu (L758–761, L595–612).
**Permissions:** tabs follow each page's own rules (mirrored by registry `tab()` entries, e.g. Leave approvals `hrms.leave.approve.l1`); search and bell need only a session.

### 2.4 Notifications popover

- **Prototype:** `HrmsPlatform.dc.html` L40 (bell), L74 (popover); `hrms-core.js` `NOTIFS`, `NOTIFS_R` (sample only), `vals().notifs/markRead/unreadLabel`.
- **Repo:** `ShellNotificationBell` (PlatformShell L805–932), `core/notifications/notificationStore.ts`, `NotificationProvider.tsx`. Backend `NotificationsController` (`/v1/notifications`), `NotificationDtos`, `AppNotificationType`, `NotificationEventCatalog`. (`shared/components/NotificationPanel.tsx` is only used by the unrouted `DashboardLayout`: dead code.)
- **Design:** 370 px, radius 12, popover shadow. Header "Notifications" + pill "N new" / "All caught up". Rows: 34 px round module icon, title, meta "`<Module>` · `<time ago>`", gold unread dot. Footer: "Mark all as read" (when unread), "Last 7 days".
- **Today:** 24 rem; up to 8 rows; severity-toned bell icon, title, 2-line body, time ago; "N new" + "Mark all read"; empty "You're all caught up"; "Loading…".

| Data point | Source | Status |
|---|---|---|
| Unread count / "N new" | `GET /v1/notifications/unread-count` | exists |
| "All caught up" | derived | exists |
| Row title | `GET /v1/notifications?page=0&size=50` → `title` (fetched when the popover opens) | exists |
| Row module label ("Leave", "Attendance"…) | `NotificationEventCatalog` has a `group` for every type (Leave, Attendance, Shifts, Work from home, Expenses and advances, Payroll, Documents, Policies, Hiring, Learning, People, Billing, Other), but `NotificationDto` doesn't return it | partial → add `group` to the DTO (S) |
| Row icon by module | same | partial |
| Time ago | `createdAt` (`formatDistanceToNow`) | exists |
| Unread dot | `readAt == null` | exists |
| "Last 7 days" | the list is the newest 50 of all time | partial → server `since` filter or client-side filter |
| Body text | `body` | exists; the design doesn't show it (§7) |

| Action | API | Status |
|---|---|---|
| Open (lazy list fetch) | `GET /v1/notifications?page=0&size=50` | exists |
| Row click → mark read + open | `PUT /v1/notifications/{id}/read` + `webRouteFor(type, data)` | partial: types the web union doesn't list (`EXPENSE_*`, `ADVANCE_SUBMITTED/APPROVED/REJECTED`, `OVERTIME_*`, `DOCUMENT_*`) fall back to `/dashboard` unless `data.route` is web-shaped |
| Mark all as read | `POST /v1/notifications/mark-all-read` | exists |
| Close on outside click / Esc | `useDismiss` | exists |

**Permissions:** every endpoint `@PreAuthorize("isAuthenticated()")`; rows belong to the JWT `employee_id` (else `sub`). No admin read of others' rows.
Note: the design's sample notifications include events the backend never sends (payroll ready for review, payslip ready, onboarding finished, probation ends, "hasn't checked in yet", self-review due). The bell shows whatever is sent; building those events is optional (gap G16).

### 2.5 More panel

- **Prototype:** `UtMore.dc.html` (whole file); opened from `HrmsPlatform.dc.html` L20 (More button), L22 (panel, 320 px, right of the rail), L73 (backdrop); `hrms-core.js` `overflowGroups`, `openMe`, `openSettings`, `openMyProfile`, `toggleTheme`, `signOut`, `help`.
- **Repo:** none. Pieces that exist: the profile menu (PlatformShell L595–612: My Profile `/profile`, My Apps `/modules`, Settings `/settings` when `canSettings`, Sign out), the gear, `ThemeProvider` (`providers/ThemeProvider.tsx`, `FORCE_LIGHT = true`, key `ut.theme`).
- **Design:** 320 px (max `100vw − 88px`), full height, square edges, 28 px left shadow. Header "More" / "Quick access & settings" + round close. Mint-gradient profile card: 54 px avatar with a green online dot, name, role/title, company, chevron; white "View my profile" button. Sections: **MY SPACE** (My workspace, My profile); overflow groups (rail group label → modules that didn't fit, excluding Business apps and "Soon" modules; the current module highlighted); **SETTINGS** (Preferences, Help & support). Footer: Light/Dark segmented control, red "Sign out". Not included: business apps, search box, Alerts. (The component carries dead search state; nothing renders it.)

| Data point | Source today | Status |
|---|---|---|
| Avatar | `useCurrentUser()` ← `GET /v1/users/me` `avatarUrl`; initials from `useDisplayName()` | exists |
| Online dot | the signed-in person is online by definition | decorative, fine |
| Name | `useDisplayName().fullName` | exists |
| Role/title line | `GET /v1/employees/me` (`jobTitle`, `departmentId` → `useDepartments`, `hrms.department.read`, every role holds it); fallback role label (`ROLE_LABELS`/`roleBadgeText`) | exists, not wired in the shell |
| Company | `useWorkspaceBranding().workspaceName` (or the employee's company via `useCompanies()`) | exists |
| Overflow groups and modules, active module | rail fit | missing (frontend only) |
| Theme state | `useTheme().resolvedTheme` | partial: forced light |

| Action | Target | Status |
|---|---|---|
| Close (X, Esc, backdrop) | none | missing |
| Profile card / View my profile | `/profile` (auth-only) | exists |
| My workspace | `/me` for people with self-service; `/dashboard` for admin roles (prototype: admin → dashboard) | exists (routes) |
| My profile | `/profile` | exists |
| Overflow module row | module's last or first page | partial (same as a rail click) |
| Preferences | first settings page the person can open: `/settings` with a settings permission, else `/settings/security` (auth-only) | exists (routes). **Likely existing bug:** `canSettings` (L464) is true for everyone because Security's registry rule is empty, but `/settings` refuses people without `settings.read`/`settings.hrconfig.write`/`settings.holidays.write`/`hrms.probation.config.read`/`workspace.profile.update`/`workspace.security.manage` (plain employees and managers by the seeds). Verify live; Preferences must not repeat it |
| Help & support | none | **missing**: no help page exists, and vendor support links are banned by the white-label rule (§10) |
| Light / Dark | `useTheme().setTheme()` | partial: dark tokens and pages are not done |
| Sign out | `saveRailVia(null)` + SDK `logout()`; `NotificationProvider` resets the store | exists |

**Permissions:** `/me` RouteGuard anyOf [`hrms.ess.read`, `attendance.checkin.self`] + ModuleGate hrms (menu: registry `me` + own employee record + not an admin role); `/profile` and `/settings/security` auth-only; `/settings` RouteGuard anyOf the six codes above; overflow rows use their module's menu rules.

### 2.6 ⌘K search dialog

- **Prototype:** `UtSearch.dc.html` (whole file); pill at `HrmsPlatform.dc.html` L39; dialog mounted at L76; `hrms-core.js` `ACTS` (role quick actions), `JUMP` (role "Jump to" pages).
- **Repo (two surfaces today):**
  - `TopBarSearch.tsx`: the header field with a dropdown. Pages (registry) as you type, plus people and records from `GET /v1/search/global` (debounced, 2+ chars). "Advanced search" link. Phone: a full-screen sheet (`variant="sheet"`).
  - `GlobalSearch.tsx` inside PlatformShell's `searchModal` (L616–631), the "Advanced search" palette, opened by ⌘K/Ctrl+K (L426–437). Empty box: Recent (localStorage per tenant+user, re-checked against permissions) + Suggested actions. Typed: Pages, Actions (`actionRegistry.ts`), People (`GET /v1/search`). "/" path navigation with Tab completion.
  - `CommandPalette.tsx` is dead code (only used by the unrouted `DashboardLayout`).
- **Design:** full-screen blurred overlay; dialog max-width 880, radius 12. Input "Search people, pages and actions", Clear, Esc. Scope chips All / People / Pages / Actions with counts. Empty box: Quick actions tiles + "Jump to". Typed: "On this page" (filter the current page's rows), People (≤5), Pages (≤6, with their tabs), Actions (≤4). Right preview: person (avatar, name, role · department, status pill, Code, Branch, Reports to, Joined), page (module, title, tab chips), action (title, description) or filter; CTA (Open profile / Open page / Run action / Filter this page). Footer keys + "Searching every module". "Nothing found for …" with a hint.

| Data point | Source today | Status |
|---|---|---|
| Pages (title, area, icon, tabs) | `useVisibleEntries()` → `PAGE_REGISTRY` (89 pages, 56 tabs) filtered by `accessState` | exists |
| Actions (title, description, icon) | `QUICK_ACTIONS` filtered by `canOpen` | exists |
| People rows (name, photo, code · department · job title) | `GET /v1/search?q=` (`EmployeeSearchHit`); also the employee group of `/v1/search/global` | exists |
| Records (leave, claims, payslips, documents, letters, candidates, offers, job openings, policies) | `GET /v1/search/global` | exists; **not in the design**, keep (§7) |
| Recent, "/" navigation | GlobalSearch | exists; not in the design, keep |
| Scope chip counts | derived from results (people capped; `truncated` flag) | partial (new UI) |
| Quick-action tiles (6) | first 6 permitted `QUICK_ACTIONS` | exists |
| Jump to | prototype: fixed pages per persona. Today: Recent + Suggested | partial: must be permission-driven (e.g. Recent, else the person's first rail modules) |
| Person preview: role · department, Code | `EmployeeSearchHit.jobTitle/departmentName/employeeCode` | exists |
| Person preview: Branch, Reports to, Joined, employment status | not in the search DTO (`GET /v1/hrms/employees/{id}` has them) | partial → extend `/v1/search` (G9) |
| Person preview: today's status (Present, Late, WFH, On leave, Absent, Not marked) | nothing per person in search | missing (G10) |
| "On this page" row | none | missing: only pages that read `?q=` can honour it (Workforce directory `?q=`, Policies `?q=`, a payroll run's employees `?q=`); hide the row elsewhere |
| Self-service hint "a holiday" | `/v1/search/global` has no holiday type (Holidays is only a page/tab) | missing (G12) or drop the word |

| Action | Status |
|---|---|
| Type (min 2 chars on the server) | exists |
| Scope chip | missing (frontend only) |
| ↑ ↓ ↵, row hover | exists |
| Tab completes a "/" path | exists (keep) |
| Row click → `openInApp(path)` + push to Recent | exists |
| Preview CTA | missing (frontend only) |
| Quick-action tile | exists (as rows) |
| "Filter this page" | missing |
| Clear, Esc, backdrop close | exists |

**Permissions:** `GET /v1/search` → `@PreAuthorize("hasAuthority('hrms.employee.read')")` (the client also skips the call without it). `GET /v1/search/global` → `isAuthenticated()`, reach per type in `GlobalSearchAccess`: employee `hrms.employee.read`; leave `hrms.leave.employee.read` (all) / `hrms.leave.approve.l1` (team) / `leave.balance.read`, `leave.request.self` (own); expense `hrms.expense.employee.read` / `hrms.expense.claim.approve` / `hrms.expense.claim.self`; payslip `payroll.runs.read` / `payroll.payslip.read.self`; document `hrms.document.read` / `hrms.document.read.self`; letter `hrms.letters.read` / `hrms.letters.read.self`; candidate, job `hrms.hiring.read`; offer `hrms.hiring.offer.read`; policy `hrms.policy.read` or `hrms.policy.acknowledge.self` (all statuses with `hrms.policy.write`). Pages and actions use their registry `access` clauses. The design shows people only to the admin persona; production is permission-based, which already happens.

### 2.7 Toast, backdrop, keyboard

- Toast (prototype L77): bottom centre, 360 px, dark `#0E1B16`, mint check icon, 2.6 s. Today there are three: sonner, `ModuleKit.useDesignToast`, the SettingsKit toast. One shared `Toast` is needed.
- Backdrop: README value `linear-gradient(270deg, rgba(14,27,22,.38), rgba(14,27,22,.2))` + `blur(4px) saturate(.85)`. The prototype markup uses 90deg/.34/.18/blur 3px; the README wins. Today: `bg-black/40 backdrop-blur-sm` (search), `rgba(15,23,42,.45)` (mobile drawer).
- Keyboard: Esc closes search first, then More/bell/menus (`hrms-core.js` `mount`); ⌘K/Ctrl+K opens search. Today: ⌘K toggles the palette and Esc closes it anywhere (L426–437); `useDismiss` closes profile/bell menus on Esc/outside click. Exists; extend to More and the Pages panel.

### 2.8 UtSections, SavedHeaderTiles, saved-designs.md

- `UtSections.dc.html`: a layout wrapper that places `UtSection` cards full width (`flex:1 1 100%`) or half width (`flex:1 1 440px`, wrapping). Used by PgAdmin, PgGrow, PgPay, PgSetup, PgTalent, PgTime. No data, no actions. Build as a shared `SectionGrid`.
- `UtSection.dc.html`: the generic section card (kinds: stats, kv, table with row actions and a segmented filter, bars, calendar, form, steps, chart, ledger, toggles, empty). This is the shared `Card`/`Section` + `ListRow` + `SegmentedControl` + `EmptyState` set other pages use.
- `SavedHeaderTiles.dc.html`: opens the platform with Header A, wide stat cards and the tile row. It confirms the README defaults.
- `saved-designs.md` says the defaults are "Header C, Stat cards A, Quick actions C". That is outdated; README and CLAUDE_CODE_PROMPT say Header A (outlined pills) + quick-action tile row. Follow the README.

### 2.9 Mobile shell (not in the prototype)

Today: `DesignMobileHeader` (menu, BrandMark, search icon → `TopBarSearch` sheet, bell, avatar with the profile menu) and the `DesignMobileNav` drawer (every rail item plus Settings). The design has no mobile shell, and the README requires self-service to work at phone widths. Recommendation: keep the pattern and restyle it. The drawer becomes the expanded rail (group labels) plus the More content (My space, Settings, theme, Sign out); the search icon opens the ⌘K dialog full screen. `live-mobile-layout.mjs` requires no sideways scroll at 390 px.

---

## 3. Navigation map: every design module, page and tab → today

Columns: design group › module › page (design tabs) · today's route and tab parameter · route guard (App.tsx) · today's menu rule (`pageRegistry.ts`; M = module gate) · notes. All pages keep their current URL.

### 3.1 Home

| Design page | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Home › Dashboard (no tabs; section pills) | `/dashboard` → `HrmsDashboard` | auth only | `MENU_RULES['/dashboard']`: anyOf `hrms.employee.read`, `attendance.team.read`, `org.company.write`, `payroll.runs.read`, `hrms.report.headcount/attrition/attendance/leave/diversity` | Rule changes with the Home decision (§5) |
| Home › Company › Companies & branches | `/hrms/companies` | anyOf `hrms.branch.read` + M hrms | `companies`: `hrms.branch.read`, M hrms | Seeds: OWNER, SUPER_ADMIN, HR_MANAGER (V129). Keep the Active/Inactive (restore) view |
| Home › Home (self-service, `ehome`) | `/me` → `EssDashboard` (alias `/hrms/ess`) | anyOf `hrms.ess.read`, `attendance.checkin.self` + M hrms | `me`: same + own employee record; hidden for admin roles (ESS rule) | EmpHome replaces EssDashboard and the old staff dashboard |

### 3.2 My team (`team`, one module with three pages)

| Design page | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Team today | `/team` → `TeamDashboard` | anyOf `attendance.team.read`, `hrms.leave.approve.l1` + M hrms | `team`: same, **noneOf `hrms.employee.read`**, M hrms | exists |
| Team schedule | a section of `/team` (`TeamSchedule`, `GET /v1/team/schedule`) | same | same | Needs its own view on the same URL (e.g. `/team?view=schedule`) |
| Approvals (All, Leave, Attendance, Requests, Expenses) | no single page: `/hrms/leave?tab=approvals` (leave + WFH), `/hrms/attendance?tab=corrections`, `/hrms/shifts?tab=requests`, `/hrms/expenses?tab=approvals`, advances approvals on `/hrms/advances` | per page | per page | New unified view on `/team` (Team audit; Undo needs backend) |

### 3.3 My work (`etime`, `eleave`, `epay`, `edocs`, `egrow`), for staff with self-service, never for admin roles

| Design page (tabs) | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Time › Attendance (This month, Timesheet) | `/hrms/attendance?tab=my`; time entries are a section of `/me` | anyOf `hrms.ess.read`, `hrms.employee.read`, `attendance.checkin.self` | `ess:/hrms/attendance`: `attendance.checkin.self` + self; tab `my` hidden for admin roles | Today's tabs for staff: My Attendance, Regularization. Timesheet has no address yet |
| Time › Work from home | `/me/wfh` | anyOf `wfh.request.self`, `hrms.ess.read`, `attendance.checkin.self` | `me-wfh`: `wfh.request.self` + self | — |
| Time › Shift change | `/me/shift-change` | anyOf `hrms.ess.read`, `attendance.checkin.self` | `me-shift` | — |
| Leave › Leave (Overview, Apply, Requests, Holidays) | `/hrms/leave?tab=balances|apply|my|holidays` | anyOf `hrms.leave.read`, `hrms.ess.read`, `leave.request.self` | `ess:/hrms/leave`: `leave.request.self` + self | Today's labels: My leave, Apply, Balances, …, Calendar, Leave types, Holidays |
| Pay › Payslips | `/me/payslips` | `payroll.payslip.read.self` + M payroll | `me-payslips` | — |
| Pay › Salary | `/me/salary` | `payroll.structure.read.self` + M payroll | `me-salary` | — |
| Pay › Expense claims (My claims, New claim) | `/hrms/expenses?tab=my|submit` | anyOf 6 expense codes | `me-claims`: `hrms.expense.claim.self` | Today reached through Expense Management |
| Pay › Advances | `/hrms/advances?tab=my` (non-admin view) | anyOf `hrms.advance.request.self/read/approve/disburse/request.others` | `me-advances`: `hrms.advance.request.self` | Today reached through Payroll |
| Documents › Letters | `/hrms/letters/my` | anyOf letters codes incl. `hrms.letters.read.self` | `me-letters` | Today a Me tab |
| Documents › My documents | `/hrms/documents?view=my` | anyOf `hrms.document.read.self`, … | `me-documents` | Not in today's Me tab list |
| Documents › My assets | `/me/assets` | `hrms.onboarding.asset.self` | `me-assets` | — |
| Documents › Policies | `/hrms/policies` (read/acknowledge view for non-policy-admins) | anyOf `hrms.policy.read/write/acknowledge.self` | `policies` | Not in today's Me tab list |
| Growth › Reviews & goals | `/hrms/performance?view=my-reviews|my-goals` | anyOf performance codes | `me-reviews`, `me-goals`: `hrms.performance.review.self` | Today under Performance & Learning |
| Growth › Learning | `/hrms/learning?view=my` | anyOf learning codes | `me-training`: `hrms.learning.enroll.self` | Today under Performance & Learning |

### 3.4 People

| Design page (tabs) | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Workforce › Master overview | `/hrms/master` | anyOf MASTER_ANY (10 codes) | `master`: same, M hrms | — |
| Workforce › Workforce directory (Active, Probation, On notice, Exited, Suspended) | `/hrms/employees?status=ACTIVE|PROBATION|NOTICE_PERIOD|EXITED|SUSPENDED` | `hrms.employee.read` (RequirePermission + RouteGuard) | `employees` | Status is a filter today, not tabs. The prototype makes the directory Workforce's default page |
| Workforce › Organization setup (Departments, Designations, Grades, Agencies) | `/hrms/organization` → `/hrms/master/companies|branches|departments|designations|grades`; Agencies = `/hrms/master/contractors` | anyOf `hrms.department.write`, `hrms.branch.write`, `hrms.designation.write` | `organization` | Today also Companies, Branches (and Classifications) |
| Workforce › Rules & policies (Policies, Shift rules, Leave rules, Manage policies) | `/hrms/master/shift-rules`, `/hrms/master/leave-rules`, `/hrms/policies` | `/hrms/master/*` guard; `/hrms/policies` guard | `m-shift-rules`: `attendance.workforce.admin` or `hrms.policy.write` | — |
| *(not in design)* Workforce › Payroll configuration | `/hrms/payroll/components` (+ `/hrms/master/statutory`) | `payroll.components.read` + M payroll | `components` | **Keep**: restored here by the client on 26 Sep |
| Hiring & onboarding › Hiring (Pipeline, Requisitions, Interviews, Offers) | `/hrms/hiring?tab=pipeline|requisitions|interviews|offers` | anyOf `hrms.hiring.read/write/candidate.write/offer.read` | `hiring`: `hrms.hiring.read` or `hrms.hiring.offer.read` | match |
| Onboarding & assets (New hires, Checklist templates, Assets) | `/hrms/onboarding/instances?view=hires|templates|assets` | anyOf instance.read, task.complete, asset.read | `recruit:/hrms/onboarding/instances`: instance.write, asset.read, template.read | match |
| Letters (Templates, Generated letters, Distributions, My letters) | `/hrms/letters/templates|generated|distributions|my` | anyOf letters codes | `letters` | match |
| Employee vault (Employee documents, My documents) | `/hrms/documents?view=all|my` | anyOf document codes | `recruit:/hrms/documents`: `hrms.document.read` or `hrms.letters.template.read` | match |
| Docs to review | `/hrms/documents/pending` (alias `/documents/pending`) | `hrms.document.verify` | `docs-review` | match |
| Performance › Performance (Review cycles, Employee reviews, Goals & KPIs, People, My reviews, My goals) | `/hrms/performance?view=cycles|reviews|kpis|people|my-reviews|my-goals` | anyOf `hrms.performance.read/write/review.self` | `performance` | match |
| Performance › Learning (Programs, My training, Skill matrix, Certifications, Skill approvals) | `/hrms/learning?view=programs|my|skills|certifications|approvals` | anyOf 6 learning codes | `learning`: read, write, enroll.self, skill.read | match |
| Employee exit › Resignation & exit (On notice, Exited, Terminated) | `/hrms/exit` | anyOf `hrms.employee.read/write` | `exit`: `hrms.employee.write` | match |
| Employee exit › Full & final (Pending approval, Pending payment, Settled, All) | `/hrms/fnf?tab=pending-approval|pending-payment|settled|all` | anyOf `hrms.fnf.read/process/approve` + M payroll | `fnf` | Today also "Create settlement" |

### 3.5 Time

| Design page (tabs) | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Attendance & time › Daily tracking (Today, Review, Manual entry) | `/hrms/attendance?tab=team|face|corrections|review|my`; Manual entry = `/hrms/attendance/manual-entry` | anyOf `hrms.ess.read`, `hrms.employee.read`, `attendance.checkin.self` | `attendance:/hrms/attendance`: `attendance.team.read` | Today's tabs: Daily Logs, Face Punch, Regularization, Review (`attendance.status.review`), My Attendance (not for admin roles) |
| Attendance analytics (Overview, Punctuality, Overtime) | `/hrms/att-analytics?tab=overview|calendar&month=` | anyOf `hrms.report.attendance`, `attendance.team.read` | `att-analytics`: `attendance.team.read` | Today: Overview, Calendar |
| Shifts & overtime (Shifts, Rosters, Overtime rules, Change requests) | `/hrms/shifts?tab=schedules|roster|overtime|requests` (`myshift` for staff) | anyOf `attendance.team.read`, `hrms.employee.read`, `attendance.checkin.self` | `attendance:/hrms/shifts`: `attendance.team.read` | Today: Shift Schedules, Roster, Overtime, Shift Requests |
| Leave › Leave operations (Approvals, Decided, Balances, Calendar, Encash, Year end, Leave types, Holidays) | `/hrms/leave?tab=approvals|history|encash|yearend|calendar|types|holidays` | anyOf `hrms.leave.read`, `hrms.ess.read`, `leave.request.self` | `leave:/hrms/leave`: anyOf `hrms.leave.approve.l1`, `settings.holidays.write`, `leave.type.write`, `hrms.report.leave` | There is no admin "Balances"; today's Balances is personal and hidden from admin roles. Order differs |

The prototype's module order puts Daily tracking first; today Attendance Analytics is first, so a rail click would land on Daily tracking instead.

### 3.6 Pay & benefits

| Design page (tabs) | Route today | Guard | Menu rule |
|---|---|---|---|
| Payroll › Payroll dashboard | `/hrms/payroll-dashboard` | `payroll.runs.read` + M payroll | `pay-dashboard` |
| Processing & payslips (All runs, Overview, Employees, Skipped) | `/hrms/payroll/runs`; `/hrms/payroll/runs/:id?tab=overview|employees|skipped` | `payroll.runs.read` | `pay-runs` |
| Salary structure | `/hrms/salary-structure` | `payroll.runs.read` | `pay-salary` |
| Payroll settings | `/hrms/payroll/settings` | `payroll.settings.read` | `pay-settings` |
| Production-linked incentive (All awards, Monthly targets, My incentives) | `/hrms/pli` | anyOf `hrms.pli.read/write/read.self` + M payroll | `payroll-hr:/hrms/pli`: `hrms.pli.read` or `hrms.pli.target.read` |
| Advances & loans (Company advances, My advances, Request an advance) | `/hrms/advances` | anyOf 5 advance codes | `pay-advances` |
| Bank disbursement (Current file, Past files, Bank profiles) | `/hrms/bank-disbursement`; Bank profiles `/hrms/bank-disbursement/setup` | `payroll.runs.read` | `pay-bank`, `pay-bank-setup` |
| Expenses › Expense center (Approvals, My claims, Submit a claim, Reimbursement batches, Policies) | `/hrms/expenses?tab=approvals|my|submit|batches|policies` | anyOf 6 expense codes | `expenses` |

PLI, advances and bank tab names are left to the Payroll audit.

### 3.7 Org & policy, Insights

| Design page (tabs) | Route today | Guard | Menu rule | Notes |
|---|---|---|---|---|
| Compliance › Statutory compliance (Compliance calendar, Statutory filings, POSH register, Inspector access) | `/hrms/compliance?view=calendar|filings|posh|inspector` | anyOf 4 compliance codes | `compliance` | match |
| Compliance › Muster roll | `/hrms/muster-roll` | anyOf `attendance.team.read`, `hrms.employee.read` | `muster` | match |
| HR setup › HR configuration | `/hrms/settings` (+ `/hrms/settings/work-time`) | anyOf `settings.hrconfig.write`, `settings.read`, `hrms.probation.config.read`, `attendance.policy.manage` | `hr-config` | Today in the rail's bottom slot |
| HR setup › Notification templates | `/hrms/notification-templates` | anyOf `hrms.notiftemplate.read/write` | `notif-templates` | — |
| HR setup › Integrations | `/hrms/integrations` | anyOf `hrms.integration.read/write` | `hr-integrations` | — |
| Reports › Reports center | `/hrms/reports` (+ six `/hrms/reports/*` pages) | anyOf the 5 report codes | `reports` | — |
| Reports › Workforce analytics (Headcount, Attrition, Diversity) | `/hrms/workforce-analytics` | anyOf `hrms.report.headcount/attrition/diversity` | `workforce-analytics` | Today one page with sections, no tabs |

### 3.8 Business apps (design shows them to the admin persona)

| Module (pages) | Routes | Guard | Visibility today |
|---|---|---|---|
| CRM (Leads, Customers, Deals) | `/crm`, `/crm/*` | `ComingSoonRoute` (ADMIN_ROLES else → `/dashboard`) + ModuleGate | Not in the HRMS rail. Launcher and search for plan admins only (registry `soon-*`, `when: planAdminOnly`) |
| Accounts (Invoices, Payments) | `/accounts/*`, `/accounting` | same | same |
| Projects (All projects, Task board) | `/projects`, `/projects/*` | same | same |
| Inventory | `/inventory` | same | same |
| Purchase (Procurement) | `/procurement`, `/purchase` | same | same |

Keep the 25 Sep rule: plan admins only (OWNER, SUPER_ADMIN, COMPANY_ADMIN). Drive the list from `useModulePlans()` so it isn't static.

### 3.9 Settings module (design: More → Preferences, admin only)

| Design page (tabs) | Route today | Guard | Menu rule |
|---|---|---|---|
| Settings (Profile, Branding, Security, Notifications, Billing & plan, Integrations, Document types, Danger zone) | `/settings` (workspace profile), `/settings/branding`, `/settings/security`, `/settings/notifications`, `/settings/billing`, `/settings/integrations`, `/settings/documents`, `/settings/danger` | `/settings` and `/settings/:tab` RouteGuard anyOf settings codes; billing RequirePermission `workspace.billing.manage`; danger anyOf `workspace.data.export`, `workspace.lifecycle.manage`; security auth-only | `s-*` entries |
| Users & access | `/users` | `workspace.users.read` | `users` |
| Roles & permissions (Roles, Who has which role, Permission catalogue) | `/roles`, `/roles?view=assignments|catalogue` | anyOf `rbac.role.write`, `platform.admin` | `roles` |
| Audit logs | `/audit-logs` | `audit.read` | `audit` |

Today the header gear opens `/settings` and shows `SETTINGS_NAV` as a tab row: Profile (→ `/profile`, the personal profile), Branding, Security, Notifications, Billing & Plan, Integrations, Users & Access, Roles & Permissions, Audit Logs, Danger Zone. Document types (`/settings/documents`) is not in that row. The design's "Profile" tab is the workspace profile (`/settings`); the personal profile is More → My profile.

### 3.10 The `me` module ("My Workspace", `PgWorkspace` + `me-*` pages)

It is not in any role's `RGROUPS` (reachable only through the prototype's page switch), and its pages are the same self-service screens as My work. It is superseded by `ehome`/`etime`/`eleave`/`epay`/`edocs`. Don't build it separately.

### 3.11 Today's entries the design's navigation doesn't list (keep reachable)

Payroll configuration and Statutory settings (Master), Import employees (`/hrms/employees/import`), My interviews (`/me/interviews`), My incentives for employees (`/hrms/pli` with `hrms.pli.read.self`), My onboarding (`/hrms/onboarding/instances?view=hires` for new hires), Manage plan (`/plan`), All apps (`/modules`), the admin-only placeholders `/analytics` and `/files`, `/hrms/soon/:key`, Master's Companies/Branches/Classifications/Contractors sections, deep pages (employee, run, program, letter, distribution details). Recommendation: My incentives under Pay, My interviews and My onboarding under Growth/Documents, shown only with their permission; the rest stay where they are and in search.

---

## 4. Decision (a): menu grouping

**Recommendation: follow the design's grouping, implemented as a presentation layer over today's menu.**

How:
- Keep every nav item's internal key (`dashboard`, `myteam`, `company`, `master`, `attendance`, `leave`, `recruit`, `payroll-hr`, `expense`, `ess`, `performance`, `compliance`, `reports`, `exit`, `hrsettings`), its path and its `MENU_RULES` key. Add a group to each item and the design's labels. `MENU_RULES` is keyed by group (`ess:/hrms/attendance`, `leave:/hrms/leave`, …): renaming a key silently falls back to the broader registry rule and changes who sees what.
- Where the design splits today's single "Employee Self Service" item into My work modules (Time, Leave, Pay, Documents, Growth), add explicit rules for the new keys that copy today's ESS rules (`attendance.checkin.self` + self; `leave.request.self` + self; …), apply the admin-role exclusion to all of them, and add them to `railLit.SELF_SERVICE_RAIL`.
- Nothing changes in URLs, route guards or who can see a page.

Why it is safe and better: permissions, URLs and visibility rules stay exactly as they are; only placement and labels change. The groups get names (today only unlabeled dividers), Company sits with Dashboard, HR setup sits with Compliance, and self-service staff get a clear My work group. The design agrees with where settings live (§7 C1 covers the gear).

Adaptations to the design:
1. Keep **Payroll configuration** as a Workforce page (26 Sep restore).
2. Page order inside modules follows the design (Attendance: Daily tracking first; Workforce's default page = directory). This changes where a rail click lands for HR. The alternative is today's order.
3. Business apps only for plan admins (25 Sep rule).
4. My team follows today's `/team` rule (team approvers without `hrms.employee.read`); My work follows today's ESS rule (own employee record, self permissions, not an admin role).
5. Settings are reached through More → Preferences, and More lights on settings pages (replaces the gear; see C1).
6. Page and tab labels follow the prompt: tab names and order stay as today where the design differs (list in §7 C10).

**Every page that moves group** (today's rail has unlabeled blocks: 1 = Dashboard, My Team · 2 = Company, Master · 3 = Attendance, Leave, Hiring · 4 = Payroll, Expenses, Me · 5 = Performance, Compliance, Reports, Exit · bottom = HR Setup):

| Page(s) and URL | Today | Design | Moves? |
|---|---|---|---|
| Dashboard `/dashboard` | block 1 | Home › Dashboard | same place, under a "Home" heading |
| Companies & Branches `/hrms/companies` | block 2 (with Master) | Home › Company | **moves** |
| Master overview `/hrms/master`, Workforce Directory `/hrms/employees`, Organization Setup `/hrms/organization`, Rules & Policies `/hrms/master/shift-rules`, Payroll Configuration `/hrms/payroll/components` | block 2, "Master" | People › Workforce | **moves** (renamed) |
| Hiring `/hrms/hiring`, Onboarding & Assets `/hrms/onboarding/instances`, Letters `/hrms/letters`, Employee Vault `/hrms/documents`, Docs to Review `/hrms/documents/pending` | block 3, "Recruitment & Onboarding" | People › Hiring & onboarding | **moves** |
| Performance `/hrms/performance`, Learning `/hrms/learning` | block 5 | People › Performance | **moves** |
| Resignation & Exit `/hrms/exit`, Full & Final `/hrms/fnf` | block 5 | People › Employee exit | **moves** |
| Attendance Analytics, Daily Tracking, Shifts & Overtime | block 3 | Time › Attendance & time | stays (page order changes) |
| Leave Operations Center `/hrms/leave` | block 3 | Time › Leave | stays |
| Payroll (7 pages) | block 4 | Pay & benefits › Payroll | stays |
| Expense Center `/hrms/expenses` | block 4 | Pay & benefits › Expenses | stays |
| Statutory Compliance `/hrms/compliance`, Muster Roll `/hrms/muster-roll` | block 5 | Org & policy › Compliance | **moves** |
| HR Configuration, Notification Templates, Integrations | bottom slot | Org & policy › HR setup | **moves** (no longer pinned; can overflow into More) |
| Reports Center, Workforce Analytics | block 5 | Insights › Reports | **moves** (own group) |
| My Team `/team` | block 1 (managers) | My team › Team today (+ Team schedule, Approvals) | **moves** to its own group |
| Employee Self Service (Overview, Attendance, Leave, Payslips, Salary, WFH, Shift change, My assets, Letters, Team Attendance) | block 4, one "Me" item with tabs | Home (Overview → Home) + My work (Time, Leave, Pay, Documents, Growth) + My team (Team Attendance) | **split** |
| Workspace settings (header gear + row) | header | More › Settings › Preferences | **moves** out of the header |
| Profile `/profile` | settings row + profile menu | More › My space › My profile | **moves** |
| All apps `/modules` | header button + profile menu | none | **no place** (open question) |
| CRM, Accounts, Projects, Inventory, Purchase | launcher only | Business apps group (plan admins) | **added** |

Totals: 22 admin pages change group, 13 keep their neighbours; the 10 self-service entries split; 13 settings pages, Profile and the launcher leave the header.

---

## 5. Decision (b): Home selection

**What decides it today**
- `/dashboard` (App.tsx L208, auth only) renders `HrmsDashboard` (HrmsDashboard.tsx L921–924):
  ```tsx
  const { isEmployee } = useRoles()
  return !isEmployee ? <AdminDashboardContainer /> : <RoleDashboard />
  ```
  `isEmployee` is true only when the person holds none of OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, HR_MANAGER, HR, DEPT_MANAGER, MANAGER, FINANCE_LEAD (`useRoles.ts`). **It is a role-name check, not a permission.** Custom roles always get the old staff dashboard (`RoleDashboard`), whatever their permissions. Introduced 25 Sep (commit `a3540595`, STATIC-UI-TO-BUILD §11.5).
- The rail's "Dashboard" link uses a permission rule: `MENU_RULES['/dashboard']` (pageRegistry L287) = anyOf `hrms.employee.read`, `attendance.team.read`, `org.company.write`, `payroll.runs.read`, and the five `hrms.report.*`.
- Inside the admin dashboard each card is gated by its endpoint's permission (AdminDashboardContainer L108–134, L319–327).
- After sign-in everyone lands on `/modules` (`RoleAwareLanding`); the HRMS tile opens `/dashboard` (`appConfig.tsx`).

**Proposed rule (no new permission, no migration)**
- `adminHome` = anyOf `hrms.employee.read`, `payroll.runs.read`, `org.company.write`, `hrms.report.headcount`, `hrms.report.attrition`, `hrms.report.attendance`, `hrms.report.leave`, `hrms.report.diversity`. This is today's Dashboard menu rule without `attendance.team.read`, the one team-scoped permission (the attendance dashboard is scoped to the caller's team through `scopedEmployees`).
- `adminHome` → Home = admin dashboard at `/dashboard` (rail "Dashboard").
- Everyone else → Home = the self-service Home at `/me` (rail "Home", house icon). `/dashboard` redirects them to `/me`, so the launcher tile, notification fallbacks and old links keep working. The old staff dashboard is retired.
- Team blocks on Home and the My team group: anyOf `attendance.team.read`, `hrms.leave.approve.l1`, and not `hrms.employee.read` (today's `/team` rule).
- A person with neither `adminHome` nor self-service (`/me`'s guard + own employee record) goes to the first page they can open (`firstOpenIn`), else `/no-access`.
- Use the same rule for `MENU_RULES['/dashboard']` and the registry `dashboard` entry; label the self-service entry "Home".
- Greetings keep `greetingName()` (first name; full name when it has fewer than 2 letters).
- The alternative, a new permission (e.g. `hrms.dashboard.admin`), would let admins toggle it per role. It needs a data migration (permission row + grants to OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD), the OWNER invariant, and a fallback until production applies it (without the row nobody gets the admin dashboard). Not recommended now.

**Who changes (default seeds; verify live)**

| Role | Today | Proposed | Change |
|---|---|---|---|
| OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN | admin dashboard; no self-service | same | none |
| HR_MANAGER (`hrms.employee.read`) | admin dashboard + Me | admin dashboard + My work | none |
| FINANCE_LEAD (`hrms.employee.read`, all reports) | admin dashboard + Me | admin dashboard + My work | none |
| **DEPT_MANAGER, MANAGER** (no `hrms.employee.read` since V112, no reports since V117, no `payroll.runs.read`/`org.company.write`) | admin dashboard + "Dashboard" link + My Team + Me | self-service Home with team blocks + My team group + My work | **moves** |
| EMPLOYEE | old staff dashboard at `/dashboard`; My workspace at `/me` | self-service Home at `/me` | staff dashboard retired |
| Custom roles | staff dashboard, whatever their permissions | by permission | becomes dynamic |

**What a department manager gains:** the self-service Home (their day, "Needs you", my requests, month calendar, leave balances, pay hidden until "Show", "Around you"); team stat cards; "Waiting for you" with inline approve/reject; "Today's team" with All / Late / Not in filters; the My team group (Team today, Team schedule, one Approvals inbox); their own My work modules.
**What they lose** from today's admin dashboard view (cards they see by permission): the live overview and the 7-day trend and check-in sources (team-scoped, `attendance.team.read`), the past-date history view (`?date=`), the operational insights counts (team-scoped alerts for fixes and leave), company notices, and Top performers / Hiring if an admin granted them those permissions. The company summary numbers are already hidden from them by the server (`DashboardSummaryController` adds each field only with its permission). To avoid real loss: Team today should carry the team's day split (and ideally a short trend), and "Around you" should include company notices (`GET /v1/admin/dashboard/notices`, open to any signed-in person) and milestones.

This reverses the 25 Sep choice for managers. The user's default in DECISIONS.md ("permission-driven homes") and the README both point this way.

---

## 6. Gaps

None of these needs a new table or column. "JDBC" means the change reads existing tables with JdbcTemplate.

| # | Gap | Backend work | Schema | Size |
|---|---|---|---|---|
| G1 | Home chosen by permission (§5); `/dashboard` → `/me` for people without an admin home; retire `RoleDashboard`; "Home"/"Dashboard" rail entry; registry and `MENU_RULES['/dashboard']` updated | none | no | S |
| G2 | Rail regrouping over today's items (groups, labels, order); My work split with new `MENU_RULES` keys copying the ESS rules; My team pages; Business apps from `useModulePlans()` for plan admins | none | no | M |
| G3 | Rail mechanics: 72/248, hover + focus expand, pin (localStorage, new key), overflow into More (ResizeObserver, `fit()` sizes 40/2/24), More badge, last page per module (sessionStorage), `railLit` keys incl. "settings lights More" | none | no | M |
| G4 | Pages panel + Pages button | none | no | M |
| G5 | Header: page tabs move into the header (a shell tab registry that `ModuleKit.Views`, the designed pages' generated bars via `scripts/design-build.mjs`, and the settings tabs publish to); keep counts and the `role=group aria-label="… views"` + `aria-pressed` semantics; single pill for pages without tabs; dashboard section pills; filter chip | none | no | L |
| G6 | More panel (profile card from `/v1/users/me` + `/v1/employees/me`, My space, overflow, Preferences → first settings page the person can open, theme switch, Sign out) | none | no | M |
| G7 | Help & support destination | New `GET /v1/workspace/admin-contacts` (isAuthenticated, tenant-scoped JDBC over `rbac.user_roles` + `auth.user_credentials` + `hrms.employees`): names and work emails of the workspace's owners and admins to contact, + hook | no | S |
| G8 | One ⌘K dialog (UtSearch design) replacing the inline dropdown and the palette: scope chips with counts, quick-action tiles, Jump to, preview aside; keep Records, Recent and "/" navigation | none | no | M |
| G9 | Person preview facts: add `branchName`, `managerName`, `dateOfJoining`, `employmentStatus` to `EmployeeSearchDtos.EmployeeSearchHit` (`WorkforceEmployeeService.search` SEARCH_SELECT joins; update `EmployeeSearchQueryTest`) | extend DTO + JDBC query | no (reads JPA-mapped `hrms.employees` through JDBC; no mapping change) | S |
| G10 | Person preview: today's attendance status | Add `todayStatus` to the search hit (or `GET /v1/attendance/today-status?employeeIds=`) using the same one-bucket rule as `attendanceBuckets`; only when the caller holds `attendance.team.read` | no | M |
| G11 | "On this page" filter + filter chip | none; each page that supports it reads `?q=` (directory, policies, payroll run employees…); hide the row elsewhere | no | M |
| G12 | Holiday results (self-service hint "a holiday") | New `SearchType.HOLIDAY` in `GlobalSearchService/Queries` over the existing holiday table, company-scoped, any signed-in person | no | S |
| G13 | Notification module label + icon | Add `group` (from `NotificationEventCatalog.forType(type).group()`) to `NotificationDtos.NotificationDto` | no (`notif.notifications` is JPA-mapped by `AppNotification`; no column change) | S |
| G14 | "Last 7 days" | Optional `since` query param on `GET /v1/notifications` (repository query on `created_at`), or filter on the client | no | S |
| G15 | Web handling of notification types it doesn't list (`EXPENSE_*`, `ADVANCE_SUBMITTED/APPROVED/REJECTED`, `OVERTIME_*`, `DOCUMENT_*`): type union, route, icon | none (frontend `notificationStore.ts`) | no | S |
| G16 | *(optional)* events the design shows that the backend never sends: payslip ready, payroll ready for review, probation ends soon, self-review due, team member not checked in, onboarding finished | Per event: enum value, catalog entry (the catalog test requires it), trigger or scheduled job, preference toggle | no (`type` is VARCHAR(60)) | M each |
| G17 | Dark mode (DARK tokens, `ThemeProvider` un-forced, Light/Dark switch) across ~4,245 hex literals in 242 files; shell first | none | no | L |
| G18 | Plus Jakarta Sans 400/500/600 everywhere (index.html still loads 700/800 and Inter; `CHROME_FONT`, ModuleKit `FONT`, search `FONT` constants, generated views; 284+ weight-700/800 usages) | none | no | M |
| G19 | White-label: no "UnifiedTree HRMS" sub-line or vendor name in the rail/More | none | no | S |
| G20 | Team module views on `/team` (Team schedule; Approvals inbox) | Team audit (Undo needs backend) | no | M |
| G21 | Timesheet addressable under My work → Time | none | no | S |
| G22 | Mobile shell restyle (drawer = expanded rail + More content; search icon → dialog) | none | no | M |
| G23 | Registry/search wording for the new labels (`SLASH_MODULES`, areas, "Home" entry), keeping old aliases | none | no | S |

---

## 7. Conflicts with existing behaviour and client decisions

- **C1. Settings gear and profile menu.** On 26 Sep the client asked for the header gear and the profile menu's Settings back (STATIC-UI-TO-BUILD §11.20; `live-settings-restored`, `live-rail-highlight` assert them). The design has no gear and no profile menu: settings open from More → Preferences, More lights on settings pages, Sign out sits in More. The settings **sections themselves stay where they are** (HR setup, Master rules, Payroll settings, Expense policies, workspace settings); the design agrees. Only the entry point changes. Recommend following the design and noting it in the plan.
- **C2. Managers' Home.** 25 Sep gave managers the admin dashboard; the design gives them the self-service Home + My team (§5).
- **C3. White-label.** The rail's "UnifiedTree HRMS" sub-line, and any vendor name in Help & support, break the rule in `workspaceBranding.ts`.
- **C4. My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN** (and COMPANY_ADMIN via `ADMIN_ROLES`): My work must stay hidden for admin roles, as the ESS group is (L457); search keeps `when: notAdminRole`. The design's admin persona has no My work, so it agrees.
- **C5. Greeting.** Homes use `greetingName()` (first name, full name when <2 letters), not a raw first name.
- **C6. Calendar.** Any date chip or day picker on the homes or header uses `src/shared/components/calendar` (`DashCalendar` already does). The prototype's 5-working-day menu (`DAYS`) must not be ported.
- **C7. Rail highlight (`railLit.ts`).** Several pages belong to two rail items (Leave, Attendance, Team; with My work also Expenses, Advances, Letters, Documents, Policies, Performance, Learning). Keep "the item you came through stays lit"; the prototype only lights the page's module. Extend `SELF_SERVICE_RAIL` to the My work keys; settings pages light More instead of the gear. Update `railLit.test.ts`.
- **C8. Settings placement details.** Payroll configuration is missing from the design's Workforce pages (keep it). Document types exists (`/settings/documents`) but is not in today's settings row (the design lists it). The design's Settings "Profile" tab is the workspace profile (`/settings`); today's row sends "Profile" to `/profile`.
- **C9. Companies & branches.** The Inactive view and restore must stay reachable when the header takes over the page's tabs/views.
- **C10. Tab names and order.** The prompt says keep today's names and order; the design's lists differ on: Workforce directory (status tabs vs a filter), Organization setup, Rules & policies, Daily tracking, Attendance analytics, Shifts & overtime, Leave operations (admin "Balances" doesn't exist), Workforce analytics, the Settings structure, and self-service Leave, Attendance and Claims. Recommend today's tabs win unless the page audit says otherwise.
- **C11. Tab counts.** The design's pills have no counts; today's view tabs show waiting counts (Leave Approvals/Encash, Attendance Face Punch/Regularization/Review, Shifts Roster/Overtime/Requests, F&F). Keep them.
- **C12. Notification body text.** The design shows only title + meta; the body today carries details (e.g. rejection reasons). Suggest one clamped line.
- **C13. Business apps audience.** The design shows them to the admin persona; the client rule is plan admins only. Existing mismatch: `ComingSoonRoute` admits `ADMIN_ROLES` (includes ADMIN) while menu/search use plan admins (excludes ADMIN).
- **C14. Launcher.** `/modules` is the post-login landing and today has two entry points (header All apps, profile menu My Apps). The design has none.
- **C15. Search content.** The design shows People/Pages/Actions only. Today's search also finds records (leave, payslips, documents, letters, candidates, offers, jobs, policies) and has Recent and "/" navigation. Keep them (no feature removal).
- **C16. `/me` for admin roles.** The prototype sends admins' "My workspace" to the dashboard. Today `/me` is still reachable by URL for owners (found-not-fixed on 26 Sep).
- **C17. Saved defaults.** `saved-designs.md` says Header C / Quick actions C; the README says Header A + tile row. The README wins.
- **C18. Search pill copy.** The README says "Find a person / a payslip / …" with different self-service words; the Header A markup says "Search people / payslips / …". Use the Header A visuals with permission-driven words.
- **C19. Rail collapse.** Removed on 22 Aug because it saved no space. The design's collapse really changes width; use a new storage key so old `sidebar-collapsed:*` values don't come back.
- **C20. Dark mode.** `ThemeProvider` forces light because dark was half done. The design requires dark mode on every page.

---

## 8. Shared components needed

From the README list: `PillTabs`, `SearchPill`, `Popover`/`Menu` (bell, menus), `SidePanel` (More: 320 px, left side, square edges), `Dialog` (⌘K), `Avatar`, `StatusPill` (search preview), `EmptyState` and `Skeleton` (notifications, search), `Toast` (one, replacing sonner / ModuleKit / SettingsKit variants), `SegmentedControl` (Light/Dark), `FilterPills` (search scopes), `ListRow` (notification, search and More rows), `Card`/`Section` (+ a `SectionGrid` for UtSections).

Shell-specific: `AppRail` (groups, separators, collapse/hover/pin, overflow measurement, More button with badge), `PagesPanel` + `PagesButton`, `TopBar` with a header-tabs slot (a context pages publish their tabs to), `DashboardSectionPills`, `FilterChip`, `NotificationBell` + `NotificationsPopover`, `MorePanel` (`ProfileCard`, sections, `ThemeSwitch`, Sign out), `SearchDialog` (+ preview aside), `Backdrop`, `MobileHeader` + `MobileDrawer`, a `useHome()` resolver, and one nav model (groups → items keyed by today's keys).

---

## 9. Risks

**Live tests that assert today's shell markup (will fail and need updating):**
- `e2e/recovery/live-rail-highlight.mjs`: `nav[aria-label="Primary"]`, `button[title=…]` full labels ("Leave Management", "Employee Self Service", "My Team", "Attendance & Time", "HR Setup", "Master", "Payroll", "Expense Management"), `aria-current`, the tab row `nav[aria-label$=" sections"]:has(> .ds-subnav-scroll)`, the gear `button[aria-label="Settings"]` + `ds-hdr-active`, the "Account" menu + "Sign out", "Open/Close navigation", `input[aria-controls="top-search-results"]`, the `Leave views` group.
- `e2e/recovery/live-navigation.mjs`: rail buttons by short label ('Master', 'Hiring', …) in `nav "Primary"`, `#workspace-content`.
- `e2e/recovery/live-settings-restored.mjs`: compares rail, gear, profile menu and tab rows with the pre-26-Sep app. Must be rewritten to compare only where each settings address lands and its sections.
- `e2e/recovery/live-w3-search.mjs`: TopBarSearch test ids (`top-search-input/-results/-loading/-empty/-advanced`), `[data-result-group=…]`, dialog "Advanced search", phone "Search" sheet + "Cancel". Keeping these ids and group attributes in the new dialog limits the churn.
- `e2e/recovery/live-w3-greeting-myatt.mjs` (staff dashboard greeting at `/dashboard`, `/me`, manager's team greeting) and `e2e/recovery/live-staff-dashboard.mjs` (old staff dashboard; already crashing on the 26 Sep baseline).

**Tests that read page tab bars the header would take over** (they survive if the header keeps the `role=group aria-label="<X> views"` + `aria-pressed` semantics): `live-design-leave`, `-expenses`, `-documents`, `-learning`, `-onboarding`, `-performance`, `-access`, `-last`, `live-fnf-tabs`, `live-fnf-admin`, `expense-batches-live`, `live-compliance-modals`, `live-inspector-browser`, `live-new-admin-browser`, `live-offers-browser`, `performance-admin-live`. Plus the section bars: `live-design-attendance` ('Attendance sections'), `live-design-payroll` ('Payroll sections'), `live-design-master` ('Master sections'), `live-design-workspace` (no shell sub-tabs).

**Others:** `live-mobile-layout.mjs` (no sideways scroll at 390 px), `live-modules.mjs` (owner: launcher → `/dashboard`), `capture-app.mjs` (scrolls `#workspace-content`), stale Playwright specs (`e2e/tests/super-admin/10-cross-cutting.spec.ts` "Sign out", `e2e/utils/selectors.ts`). Unit tests: `src/layouts/railLit.test.ts`, `src/shared/navigation/pageRegistry.test.ts`, `src/shared/search/search.test.ts`.

**Other risks**
- **Menu rules keyed by group:** new group keys that miss a `MENU_RULES` entry fall back to a wider rule (e.g. My work Leave would get the admin Leave rule).
- **Header tabs touch every page,** including generated views that must not be hand-edited (`design-build.mjs` needs support).
- **Rail mechanics:** overflow measurement can jitter while fonts load; the hover overlay covers content; touch screens have no hover.
- **Dark mode and font weights** are app-wide jobs, not shell-only.
- **Search merge:** merging two components can drop features (records, recent, "/" navigation, truncated/unavailable notices, the phone sheet).
- **Home change:** it changes managers' daily screen and custom roles' landing; the `/dashboard` → `/me` redirect must keep `?date=` links working for admin-home users only.
- **Unverified role data:** the role facts are from migrations; the local DB/API were down.
- **More panel requests:** the profile card adds two requests (`/v1/users/me`, `/v1/employees/me`); fetch lazily and cache.
- **No mobile design.**

---

## 10. Open questions (for the lead)

1. **Help & support:** there is no help page, and vendor support links are not allowed. Recommended: a small panel listing the workspace's owners/admins to contact (G7). Or something else?
2. **Way back to All apps (`/modules`):** the design removes the header button and the profile menu. Recommended: make the rail's top block open `/modules`, or add "All apps" under More → My space.
3. **Managers and admin modules:** managers also hold team-scoped permissions that show admin modules today (Attendance & time, Leave operations, Shifts, Muster roll, Expenses/Advances approvals). The README says permission-driven, so they would keep them next to My team and My work. Then "Leave" and "Time" appear twice (admin and My work). Keep them and label My work items "My time", "My leave", …? Or hide admin modules whose only grant is team-scoped?
4. **Header gear:** confirm removing it (design) although the client restored it on 26 Sep.
5. **Tab names:** keep today's names and order wherever the design's differ (C10)? Recommended yes.
6. **Missing notification events (G16):** build now or later?
