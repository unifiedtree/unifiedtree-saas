# Handoff: UnifiedTree HRMS — full UI redesign (all roles)

## Overview
A complete visual and UX redesign of the HRMS module in `unifiedtree/unifiedtree-saas` (`apps/platform/src`). It covers the app shell (rail, top bar, More panel, search), every HR-admin module page, a manager experience (team today, team schedule, approvals), an employee self-service experience (home, time, leave, pay, documents, growth), the Companies & branches page with step-by-step side panels, and a new profile layout used for every profile.

## About the design files
The files in `prototype/` are **design references built in HTML** (Design Components: `*.dc.html` + small JS helpers). They show the intended look, layout, copy and behaviour. They are **not production code**. Recreate them inside the existing React app using its patterns (`design/module/ModuleKit`, `shared/components/hr`, React Query hooks in `modules/hrms/api/*`, `@unifiedtree/sdk` permissions).

`prototype/hrms-data.js`, `prototype/emp-data.js` and `prototype/hrms-dash.js` contain **sample data only**. Nothing from them may be ported. Every number, list and label that describes data must come from the backend.

Open `prototype/ReviewBoard.dc.html` for a numbered list of every screen (grouped by role) with deep links into `prototype/HrmsPlatform.dc.html#<role>/<module>/<page>/<tab>`.

## Fidelity
**High fidelity.** Colours, type, spacing, radii, shadows, states and motion are final. Match them closely using shared components and tokens. Each `.dc.html` uses inline styles, so exact values can be read straight from the markup.

## Global rules (apply everywhere)
- **One look across the module.** The same header, cards, stat cards, tiles, lists, pills, menus and side panels on every page and for every role. Build them once as shared components and reuse them.
- **Font:** Plus Jakarta Sans (Google Fonts), weights **400, 500, 600 only**. Nothing heavier than 600. Headings 500–600, body 400, labels 500. Tabular numbers (`font-variant-numeric: tabular-nums`) in all figures.
- **Header on every page:** outlined pill tabs + pill search (see Shell). Never the old underline tabs in the top bar.
- **Popups:** side panels are square-edged (no rounded corners) with a 1px left border; menus/popovers/dialogs use 12px radius. Backdrop: `linear-gradient(270deg, rgba(14,27,22,.38), rgba(14,27,22,.2))` + `backdrop-filter: blur(4px) saturate(.85)`.
- **No dark-green filled content blocks** in pages. Content sits on white cards. Deep green is reserved for the rail, primary buttons, the active pill and small monograms.

## Design tokens
**Colours (light)**
- Brand `#0F6E56`, brand hover `#0B5A46`, brand soft `#E8F3EE`, brand soft 2 `#D2EADF`, brand line `#BFDFD1`, success `#12805F` / `#1F9D6E`
- Background `#F3F6F4`, surface `#FFFFFF`, surface-2 `#F7F9F8`, hover `#F0F4F2`, line `#E3E9E6`, line-2 `#EDF1EF`
- Ink `#0E1B16`, ink-2 `#4A5A54`, ink-3 `#6A7A73`
- Mint `#5FB39C`, pale mint `#A9D6C6`, grey `#C9D2CE`
- Status soft/text pairs: success `#E3F2EA`/`#0B5A46`; warning (gold) `#FBF1DE`/`#8A5A12` (solid `#C8912E`); danger `#FDECEA`/`#B4302A` (solid `#D9352B`, `#C4453A`); info (blue) `#E6F1FA`/`#1D6A9E` (solid `#2585C7`); leave (orange) `#FDEEE4`/`#B4541A` (solid `#E0661B`); holiday (purple) `#F1EAFB`/`#6B3DB8` (solid `#8B4FE0`); amber `#FDF3E3`/`#9A6208` (solid `#C27A0E`)
- Stat-card accents (`--k`): people `#3B6FD9`, present `#12805F`, leave `#E0661B`, late `#D9352B`, half day `#8B4FE0`, WFH `#2585C7`, not marked `#C27A0E`, absent `#D13A6E`

**Colours (dark)** (`hrms-core.js` → `DARK`): bg `#0A110E`, surface `#101915`, surface-2 `#0D1512`, hover `#16211C`, line `#1F2C27`, line-2 `#18231F`, ink `#E6EEEA`, ink-2 `#A7B6B0`, ink-3 `#80918A`, brand text `#5CC4A3`, brand soft `#10271F`, gold `#D9A441`, red `#E0645A`.

**Type scale:**
- Dashboard greeting: 30/38, weight 500, letter-spacing −0.03em
- Page title: 28/34, weight 500, −0.025em
- Section title: 16–18
- Card title: 14–15.5
- Body: 13.5–14.5
- Meta: 12.5
- Eyebrow: 11–11.5 uppercase, letter-spacing .06–.16em
- Big figures: 26–44

**Spacing:**
- Page padding: `28px clamp(16px,2.4vw,36px) 56px`
- Page max-width: 1440 (admin, companies, profiles) or 1320 (self-service)
- Gaps: section 16–20, card grid 12–16
- Card padding: 18–22

**Radius:**
- Cards: 16–20; tiles: 14–18
- Inputs: 10–12; buttons: 10–13
- Chips and pills: 999
- Menus: 12; side panels: 0

**Shadows:**
- Card: `0 1px 2px rgba(14,27,22,.05)`
- Raised card: `0 24px 50px -34px rgba(14,27,22,.4)`
- Popover: `0 24px 60px -20px rgba(14,27,22,.35)`
- Primary button: `0 12px 24px -14px rgba(15,110,86,.9), inset 0 1px 0 rgba(255,255,255,.16)`
- Active pill: `0 10px 20px -12px rgba(15,110,86,.9)`

**Motion** (`prototype/hrms-fx.js`):
- Easing: `cubic-bezier(.2,.8,.2,1)`
- Entrance: rise (fade + 8px)
- Numbers: count-up, 950ms
- Bars: grow on scaleX/Y, 750ms, staggered 35ms
- Rings: draw on stroke-dasharray, 1000ms
- Tiles: hover spotlight and gentle tilt
- Popovers: pop-in
- Levels: full, subtle or off; always respect `prefers-reduced-motion`

## Shell (`HrmsPlatform.dc.html`, `hrms-core.js`, `UtMore.dc.html`, `UtSearch.dc.html`)
**Rail:**
- Width: 72px collapsed, 248px pinned or expanded. Deep green.
- Contents: grouped icon items with separators; "More" at the bottom.
- Labels are clipped when collapsed, so no stray letters show.
- Items overflow into More when there isn't enough height.

**Top bar:** 64px, white, bottom hairline. From left to right:
- **Pages button:** shown when the module has several pages.
- **Pill tabs:**
  - Height 40, radius 999, padding 0 16px, 13.5px.
  - Active: solid `#0F6E56`, white text, active-pill shadow.
  - Inactive: white fill, 1px line border, ink-2 text.
  - Hover: brand-line border, brand-soft fill, lift 1px.
  - Horizontal scroll with a fade mask on the right.
  - Pages without tabs show one solid pill with the module icon and page name.
- **"Viewing as" pill:** prototype-only role switcher for design review. **Do not ship it.**
- **Search pill:** green round icon, rotating hint ("Find a person / payslip / leave request / report"; self-service hints differ), ⌘ K keys. Opens the ⌘K dialog.
- **Bell** with an unread badge.

**More panel (320px, square edges, full height):**
- Title "More" with the sub-line "Quick access & settings" and a close button.
- **Profile card** (mint gradient): avatar with online dot, name, role, company, chevron, and a white "View my profile" button.
- **MY SPACE:** My workspace, My profile.
- **Overflow sections:** only the modules that didn't fit in the rail, grouped by rail section.
- **SETTINGS:** Preferences, Help & support.
- **Footer:** Light/Dark segmented control, and "Sign out" in red.
- **Not included:** business apps, search box, Alerts.

**⌘K search dialog:** max-width 880, radius 12; scoped to what the current user can open.

**Notifications and role menus:** radius 12, popover shadow.

## Roles and navigation (must be dynamic)
The prototype shows three example personas (HR admin, Manager, Employee). In production **do not hardcode roles**. The UI must be driven by the signed-in user's permissions and modules, which is what `PlatformShell.tsx` already does via `visibleWithAnyPermission` and `usePermissions`/`useAnyPermission`/`PermissionGate`. Any built-in or custom role (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, EMPLOYEE, or tenant-defined) gets exactly the screens its permissions allow. A person can hold several capabilities at once.

**Capabilities and what they unlock:**
- **Self-service** (ESS / self permissions): the self-service Home and My work (Time, Leave, Pay, Documents, Growth).
- **Team** (e.g. `attendance.team.read`, `hrms.leave.approve.l1`): the My team group (Team today, Team schedule, Approvals), plus the team strip and approvals on Home.
- **Admin modules:** each module appears only with its read permission, as today.

**Home:** users with admin dashboard access get the admin dashboard; everyone else gets the self-service Home, with team blocks when they have team permissions.

**"Viewing as":** prototype-only, for reviewing roles side by side. It is **not part of the product**. Each user sees only their own experience.

## Screens (prototype file → current repo file)
**Admin:**

| Screen | Prototype file | Repo file(s) |
|---|---|---|
| Dashboard | `PgDashboard.dc.html` (+`UtLive`, `UtQuick`, `UtStat`) | `modules/hrms/HrmsDashboard.tsx`, `dashboard/AdminDashboardContainer.tsx` |
| Workforce directory | `PgDirectory` | `employees/*` |
| Add employee | `PgEmpForm` | `EmployeeForm.tsx` |
| Import | `PgEmpImport` | `EmployeeImport.tsx` |
| Master overview, org setup | `PgOrg` | `master/*` |
| Daily tracking | `PgAttendance` | `attendance/*` |
| Attendance analytics, shifts, muster roll, WFH | `PgTime` | `attendance/*`, `shifts/*`, `wfh/*` |
| Leave operations | `PgLeave` | `Leave.tsx`, `leave/*` |
| Payroll run | `PgPayroll` | `payroll/PayrollContainer.tsx` |
| Payroll dashboard, structure, settings, PLI, advances, bank, expenses, F&F | `PgPay` | `payroll/*`, `Pli.tsx`, `Advance.tsx`, `Expense.tsx`, `FullAndFinal.tsx` |
| Hiring, onboarding, letters, vault, docs | `PgTalent` | `Hiring.tsx`, `hiring/*`, `onboarding/*`, `letters/*`, `DocumentVault.tsx` |
| Performance, learning, exit | `PgGrow` | `Performance.tsx`, `performance/*`, `Learning.tsx`, `exit/*` |
| Compliance, rules, HR config, notifications, integrations, workforce analytics | `PgSetup` | matching files |
| Settings, users, roles, audit | `PgAdmin` | matching files |
| Reports | `PgReports` | `reports/*` |
| Companies & branches | `PgCompanies` | `organization/CompaniesPageContainer.tsx`, `design/dc/CompaniesPage*.tsx` |

**Manager:**

| Screen | Prototype file | Repo file(s) |
|---|---|---|
| Home (team variant) | `EmpHome` with `role=manager` | — |
| Team today | `TeamToday` | `team/TeamDashboard.tsx` |
| Team schedule | `TeamSchedule` | `team/TeamSchedule.tsx` (`GET /v1/team/schedule`) |
| Approvals | `TeamApprovals` | `usePendingApprovals`, `useLeaveDecision`, plus attendance-review, WFH, shift and expense approval hooks |

**Employee:**

| Screen | Prototype file | Repo file(s) |
|---|---|---|
| Home | `EmpHome` | `ess/EssDashboard.tsx` |
| Time (month calendar with day detail and fix-a-day, timesheet, WFH, shift change) | `EmpTime` | `ess/AttendanceHistory.tsx`, `ess/TimeEntries.tsx`, `wfh/ApplyWfh.tsx`, `shifts/ShiftChangeRequest.tsx` |
| Leave (overview, apply planner, requests, holidays) | `EmpLeave` | `Leave.tsx`, `leave/HolidayCalendar.tsx` |
| Pay (payslips, salary) | `EmpPay` | `payroll/EmployeePayslips.tsx`, `payroll/MySalaryStructure.tsx` |
| Pay (claims, advances) | `EmpClaims` | `Expense.tsx`, `Advance.tsx` |
| Documents (letters, documents, assets, policies) | `EmpDocs` | `letters/*`, `DocumentVault.tsx`, `onboarding/MyAssets.tsx`, `Policies.tsx` |
| Growth (reviews and goals, learning) | `EmpGrowth` | `performance/EmployeePerformancePage.tsx`, `Learning.tsx` |

**Profiles:** `PgProfile` (+`PgProfileTabs`) covers the HR view of any employee and "My profile" for the signed-in user. Repo: `employees/EmployeeDetail.tsx`, `employees/workspace/*`, `/profile`.

### Key screen specs
**Admin dashboard (default layout = outlined-pill header + quick-action tile row):**
- **Greeting row:** "Good afternoon, {first name} 👋" with a sub-line such as "187 of 241 people are in, and 19 things need you today". On the right: a date chip (TODAY + full date, day picker), "Export headcount" and a primary "Add employee".
- **Stat cards:** 8 cards in 2 rows. Each has an icon, label, value, note and sparkline.
- **Quick actions:** tile row with the sub-line "Most used first" and a Customise button.
- **Seats strip**, then the remaining sections, unchanged in scope.

**Self-service Home (the same visual language as the admin dashboard):**
- **Greeting row:** date chip, Check out / Check in again, primary Apply leave (managers: Review approvals).
- **Stat cards:** 4, shown by permission (Present days, Leave left, Late marks, Work from home; managers see team counts).
- **Quick-action tiles:** 6.
- **"Your day" strip:** worked time out of the shift, a progress bar, check-in time and source, Take a break.
- **Two-column cards:**
  - Needs you: tasks only this person can do, each with a due chip.
  - My requests: status pill and progress.
  - Month calendar with a legend.
  - Leave balances with meters.
  - Pay: amount hidden until "Show", next payday.
  - Around you: dated events.
- **Managers also get:**
  - Waiting for you, with inline approve/reject.
  - Today's team, with All / Late / Not in filters.

**Companies & branches:**
- **Header:** title, one-line summary, Add branch and Add company.
- **Company switcher dropdown:** a 66px trigger showing the monogram, "Company N of M" and the name. Its menu has a search input with a count, each company's name, industry, branch and headcount, a tick on the selected one, and "Add company" at the bottom.
- **Summary chips:** companies, branches, people.
- **Company card:** monogram, name, Active pill, legal name, chips, Edit and Archive. Below that, 4 KPI tiles and a "Where people work" stacked bar with a legend.
- **Registration card:** CIN, PAN and GSTIN, each with a copy button, plus the next employee ID.
- **Branches:**
  - Search, status filter pills and a Cards/Table toggle.
  - Branch card: icon, name, Headquarters tag, city and state, code chip.
  - Geofence ring: the radius scales with the boundary; it's dashed amber when no boundary is set.
  - Card details: people, status, check-in boundary ("Set it" when missing).
  - Actions: Manage, Archive.
  - A dashed "Add another branch" tile at the end.
- **Side panel (square edges, 680px):**
  - Header: title, sub-line, round close button.
  - Left step list, 196px, numbered with done/current/todo states.
  - Right: section icon, title and sub-line above the form fields.
  - Footer: Back/Cancel and Next or the final action. Next is disabled with a tooltip until required fields are filled.
  - **Create branch steps:** Branch details, Location (city, state, country, mark as headquarters), Check-in area (on/off switch, radius slider 50–500 m with a live ring preview), Review.
  - **Add company steps:** Company, Registration, Review.
  - **Manage branch:** the same steps, prefilled.

**Profile (every profile):**
- **Banner:** a soft landscape illustration, 230px tall. Cards overlap it by about 168px.
- **Left card** (about 340px, raised shadow):
  - Top: avatar, name, status pill, role and department, email.
  - Then a list of fields with icons.
  - **HR view:** read-only work fields (code, work email, mobile, reports to, location, joined), a primary Edit, and a 2-up row with Change shift and Start notice.
  - **My profile:** editable personal fields (name, email verified, mobile, city, emergency contact), and an Update button that is disabled until something changes.
- **Right card:** underline tabs, then the tab content.
  - HR tabs: Overview, Personal, Job, Attendance, Payroll, Leave, Expenses, Documents, Letters, Performance, Exit.
  - My profile hides Exit and names Payroll "My pay".
  - Tabs appear only if the viewer has permission for that data.

## Interactions and states
- Every data block has a loading skeleton, an empty state (with a friendly line and the next action), and an error state with Retry.
- **Optimistic actions:**
  - Approve, reject, sign, accept and confirm show a toast (bottom centre, dark, check icon, 2.6s) and update the row in place.
  - Approve and reject rows offer Undo while the undo is still possible.
- **Forms:**
  - Validate required fields inline.
  - Keep primary buttons disabled until the form is valid.
  - Never lose typed input when switching steps.
- **Keyboard:** Esc closes popovers and panels. ⌘K / Ctrl+K opens search.
- **Deep links:** module, page and tab live in the URL, so every tab is linkable.
- **Responsive:** grids use `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`, and cards stack on narrow screens. Self-service must work well on mobile widths.
- **Accessibility:** icon-only buttons have labels. Contrast is at least 4.5:1 for text. Focus rings are brand-coloured (`box-shadow: 0 0 0 3px #E8F3EE` plus a brand border).

## Assets
- Icons are lucide-style 24px stroke icons, inline SVG in the prototype. Use the repo's icon set (`design/dc/icons`, lucide-react).
- Profile banner: `assets/profile-banner.png` (2400×460, soft hills landscape). Use it with `background-size: cover; background-position: center bottom` and a 70px fade to the page background at the bottom.
- No other imagery.

## Files
`prototype/` is a copy of `templates/hrms-platform/`:
- `HrmsPlatform.dc.html`: app shell and routing.
- `hrms-core.js`: nav model, role personas, theme and font, search actions.
- `hrms-fx.js`: motion.
- `Pg*.dc.html`: admin pages.
- `Emp*.dc.html`: self-service pages.
- `Team*.dc.html`: manager pages.
- `Ut*.dc.html`: shared pieces (stat cards `UtLive`/`UtStat`, tiles `UtQuick`, sections `UtSection`, More `UtMore`, search `UtSearch`).
- `ReviewBoard.dc.html`: screen index.
- `saved-designs.md`: saved layout variants.
- `hrms-data.js`, `emp-data.js`, `hrms-dash.js`: sample data only, not to be ported.
