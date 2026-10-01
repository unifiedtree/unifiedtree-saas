# Audit: Companies & branches, and the profile layout (HR view + My profile)

Phase 0, read-only. 27 Sep 2026. Repo `main` at `e32a4dc6`.

Prototype files: `PgCompanies.dc.html`, `PgProfile.dc.html`, `PgProfileTabs.dc.html`, `profile-banner.png`
(also `assets/profile-banner.png`, 2400×460).

**How this was checked**
- Read README.md, CLAUDE_CODE_PROMPT.md, DECISIONS.md (including items 11–13 added today) and REDESIGN_RULES.md.
- Read the prototype markup and its logic classes. Their numbers are sample data; they were used only to learn which data points each screen shows.
- Screenshots of the prototype are in the session scratchpad:
  - `audit-cp-proto-companies.png`
  - `audit-cp-proto-profile.png` (HR view of EMP-0101)
  - `audit-cp-proto-self-admin.png`, `audit-cp-proto-self-mgr.png`, `audit-cp-proto-self-emp.png` (My profile as each persona)
- Read the repo code named in each section.
- Called the local API with GET only, as owner, hrm, fin, mgr and reader. Read `rbac.*` and a few table definitions in the local DB. The results are in section 6.

**Status words used below**
- **exists**: a hook or endpoint provides it today.
- **partial**: it mostly exists; what is missing is named.
- **missing**: backend work is needed.
- **client**: no data involved (UI state only).

---

## 1. Summary

**Companies & branches (`/hrms/companies`)**

The page exists and is live. Every data point and every action in the design already has a real endpoint. Most of the work is UI. Five things need care:

1. **The check-in step has no map.** The design's step has only a switch, a 50–500 m slider and a ring preview. A boundary can't be saved without coordinates: `PUT …/geofence` requires `latitude` and `longitude`. The existing Leaflet map and pin must stay.
2. **The per-branch switch does nothing at check-in.** The branch's "only allow check-in inside this area" switch (`geo_fence_enforced`) is stored and shown, but check-in never reads it. Branch coordinates alone decide whether a punch is flagged. Whether a punch is blocked depends on a company-wide rule.
3. **"Next employee ID" has an API the page doesn't use.** `GET /v1/settings/employee-code/preview` returns the right value. Today the page builds the number from the raw counter in HR configuration, which can lag behind real codes.
4. **Today's archive and restore features have no place in the design.** These are the Inactive view (archived branches and companies), Restore, the archive guards, the city filter, the Employees links and the employee-ID format editor. All of them must stay.
5. **Some design copy isn't true today.** Examples:
   - "The headquarters is the company's main address on letters and payslips": nothing reads the HQ branch for letters or payslips.
   - The review step shows "Code: Auto": the server does not generate codes.

**Profiles**

- **HR view (`/hrms/employees/:id`).** It exists with the same 11 tabs, in the same order and with the same `?tab=` keys, and nearly all the data.
  - Missing backend pieces:
    - a month calendar for any one employee
    - a payslip list for any one employee
    - direct reports
    - the last sign-in device
    - document counts by status
    - a per-employee F&F lookup
    - the letter's signed date
    - "Apply on behalf" (leave) and "New claim" for another person
  - A department manager can't open a profile today. The route lets them in, but `GET /v1/hrms/employees/{id}` returns 403 (seen live).
- **My profile is the largest change.** Today `/profile` is a settings-style page: photo, face enrollment, employment, personal details, approval delegation, my documents and notifications. It is also the "Profile" tab of the Settings row, and seven live tests assert its markup and `#st-…` anchors. The design's My profile is the full tabbed profile. It needs APIs that don't exist:
  - reading your own personal sections (addresses, education, experience, dependents)
  - reading your own workforce record (probation, confirmation, manager name)
  - a decision on which fields people may edit about themselves.

---

## 2. Companies & branches

### 2.1 Screen map

| Design | Repo | State |
|---|---|---|
| `PgCompanies.dc.html` L11–70: header, company switcher, summary chips, company card, registration card, branches (cards/table), empty state | Route `/hrms/companies` (App.tsx L366–372, lazy `Companies`).<br>Container `modules/hrms/organization/CompaniesPageContainer.tsx`.<br>Logic `design/dc/CompaniesPage.tsx`, generated view `design/dc/CompaniesPage.view.tsx` + `.view.css`.<br>Frame `design/dc/DesignFrame.tsx` (1320 px max, Inter). | Exists, live (`STATIC-UI-TO-BUILD.md` §3 "done") |
| `PgCompanies.dc.html` L71–91: side panel (Create branch / Manage branch / Add company) | `design/dc/BranchDrawer.tsx` + `.view.tsx`, `design/dc/CompanyDrawer.tsx` + `.view.tsx`, `design/dc/GeofenceMap.tsx` + `.view.tsx` (Leaflet, Esri tiles) | Exists (not a real stepper today: BranchDrawer is one scrolling form with a jump list; CompanyDrawer is a single form) |
| Hooks | `modules/hrms/api/useOrg.ts`: `useCompanies`, `useCompaniesWithArchived`, `useBranches(…, {includeArchived})`, `useCreate/Update/ArchiveCompany`, `useRestoreCompany`, `useCreate/UpdateBranch`, `useSaveBranchGeofence`, `useArchiveBranch`.<br>`modules/hrms/api/useSettings.ts`: `useHrConfig`, `useUpdateHrConfig`, `useNextEmployeeCode`. | Exists |
| Backend | `WorkforceController` L113–213 (`/v1/hrms/companies`, `/v1/hrms/branches`).<br>`CompanyService` (archive guards, audit).<br>`BranchService` (HQ swap, geofence, archive).<br>`LiveHeadcount` (people counts).<br>`SettingsController` L36–87 (HR config, code preview). | Exists |
| Old URL `/hrms/attendance/geofencing` | `<Navigate to="/hrms/companies">` (App.tsx L385) | Keep |
| Same records, other screens | `/hrms/organization` (Companies / Branches tabs), `/hrms/master/companies`, `/hrms/master/branches` (see workforce.md) | Share the same APIs, so backend changes here affect them |

Shell: prototype module `company` → page `c-cb` "Companies & branches", in the rail's **Home** group next to Dashboard. It has no tabs, so the top bar shows one solid pill "Companies & branches". Today's rail item is `company` "Company Profile" with one child (PlatformShell L99–103).

### 2.2 Data points

| # | What the design shows | Source today | Status |
|---|---|---|---|
| D1 | Header line: "N companies · N branches · N people. Switch company below…" | `useCompanies` → `GET /v1/hrms/companies` (count); `useBranches(undefined,{includeArchived:true})` → active count; Σ `Company.employeeCount` | exists (today's page prints only "N companies · N branches") |
| D2 | Switcher trigger (66 px): monogram, "COMPANY N OF M", name, "Switch" | companies list (initials derived; N = index in the active list) | exists |
| D3 | Switcher menu: search with "N total"; per company name, "industry · N branches · N people", tick on the selected one; "No company matches that search." | companies + branches per company + `employeeCount` | exists (industry is often blank → "—") |
| D4 | Summary chips: companies, branches, people | as D1 | exists |
| D5 | Company card: monogram, name, **Active** pill, legal name | `Company.name`, `legalName`, `active` | exists |
| D6 | Chips: industry · "India · INR" (country · currency) · "HQ · <HQ branch>" | `Company.industry`, `country`, `currency`; branch with `headquarters=true` | exists (HQ can be "Not set") |
| D7 | KPI tile **Branches** | active branches of the company | exists |
| D8 | KPI tile **People** | `Company.employeeCount` (LiveHeadcount: ACTIVE, PROBATION or NOTICE_PERIOD) | exists |
| D9 | KPI tile **Geofenced "x of y"** | branches with `geoFenceEnforced` | partial: the flag is stored but check-in ignores it; coordinates decide (G-C1) |
| D10 | KPI tile **Next employee ID** | `GET /v1/settings/employee-code/preview?companyId=` → `{preview:"EMP-0143", prefix, nextNumber, padding}`. Non-consuming; max(counter, highest existing code + 1) | exists as an API. The page today composes `${prefix}-${next}` from `GET /v1/settings/hr-configuration` instead (can lag). 403 for mgr and reader (G-C3) |
| D11 | "Where people work": "N people across M branches", stacked bar and legend ("Branch · N") | `Branch.employeeCount` (live) per active branch; `Company.employeeCount` | exists. Partial: people with no branch are not a segment. Demo company: 19 people, 12 in its only active branch (G-C5) |
| D12 | Registration card: **CIN**, **PAN**, **GSTIN** (monospace, copy button each) | `Company.registrationNumber`, `panNumber`, `gstin` | exists |
| D13 | Registration card: **Next employee ID** row | as D10 | exists (API) |
| D14 | Branches: count badge; line "Offices under <company> … N still need a boundary." | branches | exists (the "boundary" count follows D9). The prototype writes the company monogram ("Offices under DT"); use the name |
| D15 | Branch card: icon, name, **Headquarters** tag, city, state, code chip | `Branch.name`, `headquarters`, `city`, `state`, `code` | exists |
| D16 | Geofence ring: radius scales the ring (`12 + min(500,r)/500·26`); dashed amber when no boundary | `geoFenceRadiusMeters`, `latitude`/`longitude`, `geoFenceEnforced` | exists (semantics as in D9) |
| D17 | Branch **People** | `Branch.employeeCount` | exists |
| D18 | Branch **Status** Active / Inactive | `Branch.active` (Inactive = archived in our model) | exists |
| D19 | **Check-in boundary** "N m around the office" / "Not set · Set it" | as D16 | exists |
| D20 | Table: Branch, Code, City (city, state), People, Boundary, Status, Manage | same fields | exists |
| D21 | Empty filter result: "No branches match. Clear the search or pick another status." | client | client |
| D22 | *(today, not in the design)* archived branches under **Inactive** with Restore; archived companies under Inactive after the branches; on the empty page (no active company) every archived company with Restore | `GET …/branches?includeArchived=true`, `GET …/companies?includeArchived=true` | exists; must stay (client decision) |
| D23 | *(today)* loading skeleton, error + Retry, "Archived companies didn't load" + Retry | query states | exists; must stay |

Not shown by the design or today: company `description`, `tanNumber` and `incorporationDate` (V143.22, edited on Master → Companies). The container hard-codes `desc: ''` → "No description yet." That text disappears with the redesign.

### 2.3 Actions

| # | Action | API | Status | Permission today |
|---|---|---|---|---|
| A1 | **Add branch** (header) and the dashed **Add another branch** tile | `POST /v1/hrms/branches`, then `PUT /v1/hrms/branches/{id}/geofence` when a pin is set | exists | `org.company.write`; boundary `org.geofence.write` (without it the branch saves and the page says why) |
| A2 | **Add company** (header, and the switcher's footer) | `POST /v1/hrms/companies` (409-style `DUPLICATE_COMPANY` on a clash) | exists | `org.company.write` |
| A3 | Open switcher, search, pick a company | client (Enter picks the first match today) | client | — |
| A4 | **Edit** company | `PUT /v1/hrms/companies/{id}`. Sends every field; `""` clears it | exists | `org.company.write` |
| A5 | **Archive** company | `DELETE /v1/hrms/companies/{id}`. 422 `LAST_ACTIVE_COMPANY` / `COMPANY_HAS_EMPLOYEES` with the exact sentence; audit row. The UI shows "Can't archive yet" + OK, and the Archive tooltip gives the reason | exists; keep the guard dialog and tooltip | `org.company.write` |
| A6 | **Copy** CIN / PAN / GSTIN | `navigator.clipboard` + toast | client (new) | — |
| A7 | Cards / Table, search, status pills (All statuses / Active / Inactive) | client, plus the `includeArchived` data | client | — |
| A8 | **Manage** branch (open prefilled, save) | `PUT /v1/hrms/branches/{id}` (partial; `isHeadquarters:true` swaps the HQ in one save) + `PUT …/geofence` | exists | `org.company.write` (read-only users get **View**) + `org.geofence.write` |
| A9 | **Archive** branch | `DELETE /v1/hrms/branches/{id}` (soft; clears HQ; people keep the branch) | exists | `org.company.write` |
| A10 | **Set it** (branch without a boundary) opens Manage at the Check-in step | `PUT …/geofence` | exists | `org.geofence.write` |
| A11 | *(keep)* **Restore** branch | `PUT /v1/hrms/branches/{id}` `{isActive:true}` | exists | `org.company.write` |
| A12 | *(keep)* **Restore** company (+ confirm) | `POST /v1/hrms/companies/{id}/restore` | exists | `org.company.write` |
| A13 | *(keep)* Employees links (company tile and each branch) | navigate `/hrms/employees?companyId=…&branchId=…` | exists | directory needs `hrms.employee.read` |
| A14 | *(keep)* City filter | client | exists | — |
| A15 | *(keep)* **Save format** (employee-ID prefix + starting number, in Edit company) | `PUT /v1/settings/hr-configuration?companyId=` | exists | `settings.hrconfig.write`. The UI doesn't check it today, so HR managers see it and get 403 (G-C4) |

### 2.4 Side panels

The design: 680 px wide, square edges, 1 px left border, gradient-blur backdrop. Parts:
- Header: title, sub-line, round close button.
- A 196 px step list with done, current and todo states.
- A section icon, title and sub-line above the fields.
- Footer: Cancel or Back, then Next or the final action. Next is disabled, with a tooltip, until the required fields are filled: "Add the branch name", "Add the city", "Add the company name".
- Clicking an earlier step goes back; a later step only opens when nothing is missing.

**Create / Manage branch** ("Create branch"; Manage shows "Manage <name>" and saves with "Save changes")

| Step | Design fields | Today (BranchDrawer) | Status |
|---|---|---|---|
| 1 Branch details | Branch name *, Code | name * (error "Enter a branch name."), code (A–Z and 0–9, upper-cased) | exists |
| 2 Location | City *, State * (select, 10 states), Country * (India); **Mark as headquarters** tile ("…main address on letters and payslips") | city *, state * (13 states), country fixed "India"; HQ checkbox; hint "Replaces X as the headquarters." when another HQ exists | exists. The state list should cover every state and UT (G-C6). The HQ copy isn't true (C3) |
| 3 Check-in area | switch "Only allow check-in inside this area" / "Mobile and web punches outside it are flagged"; radius slider 50–500 m, step 10 ("50 m · one building", "500 m · a campus"); 150 px ring preview | switch (`geoFenceEnforced`); **Leaflet map, click to drop the pin**; Latitude, Longitude; "Centre on <city>" (10 city presets); radius input 25–5,000 m ("Radius must be between 25 and 5,000 metres.") | partial. The design has no pin, but `PUT /geofence` requires latitude and longitude (`@NotNull`), so keep the map inside this step (C1). The design's range is narrower than today's (C2). The switch copy doesn't match what check-in does (G-C1) |
| 4 Review | Name, Code ("Auto" when blank), Address, Headquarters, Check-in area ("N m around the office" / "Anywhere"), Company | review block exists | partial: a blank code is saved as `null`, not generated (G-C2) |

**Add company** ("Add company" / "Set up another legal entity in this workspace.", final "Create company"). The design's Edit uses the same panel prefilled; the prototype only toasts "Edit … name, logo and registration".

| Step | Design fields | Today (CompanyDrawer) | Status |
|---|---|---|---|
| 1 Company | Company name *, Legal name ("As registered with the MCA"), Industry (select of 5), Country (India) | name * ("Enter the company name."), legal name, industry **free text**, country India and currency INR fixed | exists. The Industry select conflicts with free-text values (C5) |
| 2 Registration | CIN, PAN, GSTIN | same (upper-cased, spaces removed) | exists |
| 3 Review | Name, Legal name, Industry, CIN / PAN / GSTIN ("Add later") | none | client |
| *(Edit only, today)* | Employee ID auto-generation: Prefix (1–10 letters or digits), Starting number (1–8 digits), "Next employee will be: EMP-0001", **Save format**, "Changes only affect employees created after saving." | exists | keep (C6) |

Toasts after a save:
- **Design:** "<name> added to <co>", "Saved <branch>", "<company> created. Add its first branch next."
- **Today:** "<name> created", "Branch updated", "Company updated", "Employee ID format saved · next is EMP-0143".

Toasts must stay real: show them only after the API succeeds, and show the server's message on failure.

### 2.5 Permissions today

- **Nav / search.**
  - `pageRegistry.ts` L121: `page('companies', 'Companies & Branches', '/hrms/companies', 'Company', 'company', [{ ...any('hrms.branch.read'), module: HR }], { aliases: [..., 'geofence', 'geofencing', 'attendance/geofencing', 'punch-zones'] })`.
  - PlatformShell `MODULE_ITEMS` key `company` → child `/hrms/companies`. Visibility goes through `menuRule(path)`, which falls back to the registry entry; `visibleForRoles` is no longer read.
- **Route.** App.tsx L366–372: `<RouteGuard anyOf={[P.HRMS_BRANCH_READ]}><ModuleGate moduleKey="hrms">`.
- **Reads.** `GET /v1/hrms/companies`, `/companies/{id}` and `/branches`: `@PreAuthorize("hasAuthority('org.company.read') or hasAuthority('platform.admin')")`.
- **Writes.**
  - Companies (POST, PUT, DELETE, `/restore`) and branches (POST, PUT, DELETE): `hasAuthority('org.company.write')`.
  - `PUT /branches/{id}/geofence`: `hasAuthority('org.geofence.write')`.
- **Employee code.**
  - `GET /v1/settings/employee-code/preview`: `hasAnyAuthority('settings.read','hrms.employee.write')`.
  - `GET /hr-configuration`: `hasAnyAuthority('settings.read','settings.hrconfig.write','hrms.employee.write','attendance.policy.manage')`.
  - `PUT /hr-configuration`: `hasAuthority('settings.hrconfig.write')`.
- **UI** (CompaniesPageContainer L28–30):
  - `canEdit = usePermission(P.ORG_COMPANY_WRITE)`: Add, Edit, Archive, Restore, and Manage vs View.
  - `canReadCompanies = usePermission(P.ORG_COMPANY_READ)`: the archived-companies query.
  - `canGeofence = usePermission('org.geofence.write')`: saves the boundary, otherwise shows "Your role can't change geofences."
- **Who holds them** (system roles, local DB).
  - `hrms.branch.read`, `org.company.read`, `org.company.write`, `org.geofence.write`: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER.
  - FINANCE_LEAD, DEPT_MANAGER and EMPLOYEE hold only `org.company.read`, so they get no menu item or page.
  - `settings.hrconfig.write`: OWNER, SUPER_ADMIN, ADMIN.
- **Live check.** Owner, hrm, fin, mgr and reader all get 200 on `/companies` and `/branches`. The preview and `hr-configuration` return 200 for owner, hrm and fin, and 403 for mgr and reader.

**Proposed gating for the new markup (mirrors today)**
- Header Add branch / Add company, the switcher's Add company, company Edit and Archive, branch Manage (otherwise View) / Archive / Restore, and the Add-another tile: `org.company.write`.
- "Set it" and the Check-in step's controls: `org.company.write` + `org.geofence.write`. Without the geofence permission the step is read-only, with the existing note.
- Next employee ID (KPI tile and Registration row): `settings.read` or `hrms.employee.write`; otherwise hide the tile.
- Edit format: `settings.hrconfig.write`.
- Copy buttons and filters: anyone who can open the page.

### 2.6 Gaps and the backend work they need

| ID | Gap | Backend work | Schema | JPA-mapped table | Size |
|---|---|---|---|---|---|
| G-C1 | The per-branch check-in switch (`org.branches.geo_fence_enforced`) is display-only. `AttendanceContextResolver.resolve` uses a branch's coordinates whenever they are set, whatever the switch says. Whether a punch is blocked depends on the company rule `enforceGeofencingForMobile` and the server switch (AttendanceController L152–158); otherwise it is flagged. Demo: "Local QA Office" has the switch off with coordinates set, so its punches are still flagged. | If the switch should be real (Q3): in `AttendanceContextResolver` (and the face / assisted-punch paths that share it), treat a branch whose switch is off as having no boundary. Add tests. Update the live tests that assume flagging. Otherwise only the copy changes. | No | `org.branches` (two entities: `workforce/entity/Branch`, `tenant/entity/Branch`); no column change | S |
| G-C2 | "Code: Auto": the server stores `null` for a blank code. | `BranchService.create`: when the code is blank, derive one from the name (upper-case, at most 30 characters; add a number if an active branch in the company already has it). `org.branches.code` is not unique. Or show "None" (Q6). | No | `org.branches` | S |
| G-C3 | Next employee ID comes from the raw counter. | None. Use `useNextEmployeeCode(companyId)` (exists); hide it for roles without `settings.read` / `hrms.employee.write`. | No | — | S (frontend) |
| G-C4 | The employee-ID format editor has no permission check (HR managers get 403). | None. Show it only with `settings.hrconfig.write`. | No | — | S (frontend) |
| G-C5 | People with no branch are missing from "Where people work". | None. Grey segment = `company.employeeCount − Σ active branch counts`, labelled "No branch · N". | No | — | S (frontend) |
| G-C6 | The state list is partial (13 today, 10 in the design). | None. Use a full reference list of states and union territories; it is reference data, not sample data. | No | — | S (frontend) |

Not a gap: a company logo. The prototype toast mentions "logo", but the design's form has no logo field. `Company.logoUrl` exists, but there is no upload endpoint. Not planned.

### 2.7 Conflicts with today's behaviour and earlier decisions (and how to adapt)

- **C1. No pin in the check-in step.** Keep the Leaflet map, the pin and "Centre on <city>" inside the Check-in area step. Put the ring preview and the slider beside or under the map. Without a pin the step can't save a boundary.
- **C2. Radius range.**
  - Design: 50–500 m slider.
  - Today: 25–5,000 m input.
  - Server: 1–100,000. A new branch created without a radius defaults to 500; the demo branch uses 375.
  - Recommendation: a slider plus a number field, with today's limits (Q5).
- **C3. Headquarters copy.** "Main address on letters and payslips" isn't true: letters and payslips don't read the HQ branch. Keep today's accurate hint ("…used as the primary company location" / "Replaces X as the headquarters.").
- **C4. Inactive view, restore and archive guards (client decision).** The design has no place for archived companies. Keep them under the **Inactive** status pill, after the archived branches, with Restore and its confirm ("Restore <name>? It shows in lists and pickers again."). Keep the empty page that lists archived companies when none is active. Keep "Can't archive yet" + OK, with the exact server sentence, and the Archive tooltip. Restore replaces Archive on inactive branch cards.
- **C5. Industry.** The design's select (IT Services, Retail, Manufacturing, Non-profit, Logistics) can't show existing free-text values (up to 50 characters). Use a combobox: suggestions plus free text.
- **C6. Employee-ID format editor.** The design doesn't have it. Keep it as a small "Edit format" action on the Registration card's Next employee ID row, gated by `settings.hrconfig.write`. The HR configuration page, a settings section, keeps its own copy of the setting (settings stay in their own sections).
- **C7. Removed controls.** The **city filter** and the **Employees** links (company tile, each branch) aren't in the design. Search already matches city, so the filter can fold into it. Keep the links by making the People tile and the branch People figure open the filtered directory.
- **C8. Read-only users.** Today, people without `org.company.write` see no Add, Edit or Archive, and get "View" instead of "Manage". The design shows everything, so gate it (§2.5).
- **C9. Counts.** In the prototype, inactive branches count in the totals. In our model inactive means archived, and today's totals and cards count active branches only. Keep ours.
- **C10. Page width and font.** The design uses max width 1440 and Plus Jakarta Sans. `DesignFrame` is 1320 and Inter.
- **C11. Rail group.** The prototype puts "Company" in the Home group. DECISIONS 11 makes groups a presentation layer. `railLit` must still light the company item on `/hrms/companies`.

### 2.8 Components

- **From the shared kit:** PageHeader (eyebrow "Company", title, one-line summary, actions), Dropdown with search (company switcher), chips, Card/Section, SegmentedControl (Cards/Table), FilterPills (status), search input, StatusPill, Ring (branch card and panel preview), Meter (stacked-bar variant with legend), Avatar/monogram (brand, blue and purple tones), EmptyState, Skeleton, Toast, Dialog (archive/restore/guard), SidePanel with stepper and sticky footer, FormField (input, select, combobox, toggle, slider), Tooltip.
- **Page-specific:** CompanySwitcher (66 px trigger), KPI mini tile (icon, label, value; not the sparkline StatCard), "Where people work" bar, Registration list with copy buttons and the Next-ID row, BranchCard, AddBranchTile, headquarters checkbox tile, GeofenceMap (kept, restyled; map tiles stay light in dark mode), RingPreview.

### 2.9 Risks

- **Two live tests assert today's markup.** Update the selectors and keep every check (full list in §4).
  - `live-design-companies.mjs` asserts:
    - text "Statutory information"
    - the buttons "Add branch", "Create branch", "Manage", "Save changes", "Save format"
    - placeholders "e.g. Mumbai Office", "MUM", "Mumbai" and "Registered legal name"
    - a `select` containing "Select state"
    - `article` cards showing "On · 100 m"
    - panel titles "Edit branch" and "Edit company"
    - the toast "Employee ID format saved".
  - `live-company-restore.mjs` asserts:
    - `aside[aria-label="Companies"]`, `button[aria-labelledby="co-pick-label"]` and label "Search companies"
    - the status filter as a dropdown with options
    - the heading "Archived companies" and `h4` names
    - the Table/Cards buttons
    - every dialog sentence, the Archive tooltip text, phone-width checks, and API/DB checks.
- **Backend changes are shared.** Changes to `BranchService` or the geofence rule also affect Organization Setup, Master → Branches and the mobile app. G-C1 changes check-in behaviour for every tenant, so ask first (Q3).
- **Boundary saves are two calls.** `CreateBranchRequest` accepts latitude, longitude and radius under `org.company.write` alone. Keep saving the boundary through `PUT /geofence` so `org.geofence.write` stays enforced.
- **Map in dark mode and on phones.** Esri street tiles stay light in dark mode. At 390 px the 196 px step list must turn into a horizontal step row.
- **Generated views.** `CompaniesPage.view.tsx` is generated by `scripts/design-build.mjs` from the old export. Once the page moves to the new kit, running that script would regenerate the old view files. Take the page out of the script's list, or leave the generated files unused.
- **Route vs API permissions.** The route and menu use `hrms.branch.read`, but the API needs `org.company.read`. A custom role with only the first sees the page and gets 403s. No system role is affected.

---

## 3. Profiles: HR view of any employee, and My profile

### 3.1 Screen map

| Design | Repo | State |
|---|---|---|
| HR view: `PgProfile.dc.html` (self=false) + `PgProfileTabs.dc.html` | Route `/hrms/employees/:id` (App.tsx L334–344).<br>Container `modules/hrms/employees/EmployeeDetail.tsx`.<br>Logic `design/dc/EmployeeWorkspace.tsx`, generated view `design/dc/EmployeeWorkspace.view.tsx`.<br>Tab sections `employees/workspace/{EmployeePersonal, EmployeeJob, EmployeeAttendance, EmployeePayroll, EmployeeLeave, EmployeeExpenses, EmployeeDocuments, EmployeeLetters, EmployeePerformance, EmployeeExit, shared}.tsx`.<br>Full form `employees/EmployeeForm.tsx`. | Exists. The layout changes; the tabs and data are largely there |
| My profile: `PgProfile.dc.html` (self=true) | Route `/profile` → `pages/Profile.tsx` (SettingsKit page) + `pages/DelegationCard.tsx`, `pages/MyDocumentsCard.tsx`, `pages/NotificationChoices.tsx`, `modules/hrms/attendance/face/FaceEnrollment.tsx` (`MyFaceEnrollmentSection`) | A different page exists. The tabbed My profile does **not** exist (Q1) |
| Banner `profile-banner.png` | not in the repo (`apps/platform/src/assets` has only logos) | new asset |

Where people open it:
- **HR view:** directory rows, Daily Logs ("Open full profile"), dashboard lists, ⌘K (URLs `/hrms/employees/{id}?tab=leave|documents|…`, asserted by `live-w3-search.mjs`), and the manager link inside a profile.
- **My profile:** More → My space → My profile, and the More profile card's "View my profile" (shell.md). Today it opens from the profile menu (My Profile) and the Settings row (Profile).

### 3.2 Layout, header and tabs

- **Banner.** 230 px high: `background: #D6EAE1 url(profile-banner.png) center bottom / cover`, plus a 70 px fade to `--u-bg`.
  - The content starts 168 px higher so the cards overlap the banner.
  - Max width 1440; `DesignFrame` today is 1320 with Inter.
  - The image is a light sky-and-hills picture and there is no dark version. REDESIGN_RULES says the design's own dark mode is incomplete here.
- **Left card** (340 px, radius 22, raised shadow) and **right card** (underline tabs inside the card, then the content).
- **Top bar.** No pill tabs; one solid pill, "Employee profile" or "My profile". The search pill hint reads "Search this profile…".
- **HR tabs.** Overview, Personal, Job, Attendance, Payroll, Leave, Expenses, Documents, Letters, Performance, Exit. This is the same set and order as today's `TABS` (EmployeeDetail L66), and `?tab=<key>` stays (replaced, not pushed).
- **My profile tabs.** Exit is hidden, and Payroll becomes "My pay". In the prototype the admin's own profile shows only Overview, Attendance and My pay; the manager's and employee's show all tabs except Exit.
- **Today the tabs are `role=tab`.** `live-design-workspace.mjs` and `live-dead-entrypoints.mjs` click `getByRole('tab', …)`. The design draws plain buttons with `aria-current`, so keep a real ARIA tablist.

### 3.3 Left card, HR view

| # | Data point | Source today | Status |
|---|---|---|---|
| L1 | "← Workforce directory" | history back, else `/hrms/employees` | exists |
| L2 | Avatar: initials, or the photo | `WorkforceEmployee.profilePhotoUrl` | exists |
| L3 | Green "Checked in" dot | today's day in `useEmployeeWeeklySummary` (check-in, no check-out) | exists (needs `attendance.team.read` and the object scope, else hide) |
| L4 | Name, status pill (Active / Probation / Notice period / Exited…) | `firstName`/`middleName`/`lastName`, `employmentStatus` | exists |
| L5 | "<designation> · <department>", email | `useDesignations`, `useDepartments`, `email` | exists |
| L6 | Employee code | `employeeCode` | exists |
| L7 | Work email with a green tick | `email`; tick from `GET /v1/employees/{id}/invitation-status` → `activated` | partial: there is no "verified" flag; account activation is the closest real signal |
| L8 | Mobile | `phone` | exists |
| L9 | Reports to | `useEmployeesByIds([reportingManagerId])` | exists (`hrms.employee.read`) |
| L10 | Work location | branch name (`useBranches`) | exists |
| L11 | Joined + tenure ("12 Mar 2022 · 4 yrs 6 mos") | `dateOfJoining` | exists (tenure computed) |

| # | Action | API | Status | Permission |
|---|---|---|---|---|
| LA1 | **Edit profile** (primary) | Edit panel, Basic then Financial → `PUT /v1/hrms/employees/{id}` (changed fields only). "All fields…" opens `EmployeeForm` | exists | `hrms.employee.write` |
| LA2 | **Change shift** | `POST /v1/shifts/employee/{id}` `{shiftPolicyId, effectiveFrom?}`; a future date schedules it | exists | `attendance.workforce.admin` |
| LA3 | **Start notice** | `POST /v1/hrms/employees/{id}/notice?noticeStart&lastWorkingDay&reason&exitType` | exists | `hrms.employee.write` |
| LA4 | *(keep)* Confirm probation / Extend probation / Cancel notice / Mark exited, by status | `POST …/{id}/confirm`, `POST /v1/probation/employees/{id}/extend`, `POST …/{id}/cancel-notice`, `POST …/{id}/exit` | exists | `hrms.employee.write` |
| LA5 | *(keep)* Send / Resend invitation | `sendInvite` / `resendInvite` (`POST /v1/employees/{id}/invite`…) | exists | `hrms.employee.invite` |
| LA6 | *(keep)* Enroll face with the web camera; Reset face | `…/face/admin/employees/{id}/enroll/*`, `POST /v1/attendance/face/admin/employees/{id}/reset` | exists | `attendance.face.admin.reset` |

### 3.4 Left card, My profile

| # | Field (the design lets the person edit it) | Source today | Status |
|---|---|---|---|
| M1 | Avatar (photo), dot | `useCurrentUser().avatarUrl`; `GET /v1/attendance/today` (204 when not checked in) | exists; keep **Change photo** (`useUploadAvatar`, JPG/PNG/WebP/HEIC/GIF ≤ 5 MB) |
| M2 | Name, status, "<job title> · <department>", email | `GET /v1/users/me` (displayName, email); `GET /v1/employees/me` (employmentStatus, jobTitle, departmentId). EMPLOYEE holds `hrms.department.read` | exists |
| M3 | **First name**, **Last name** | `GET /v1/users/me` firstName/lastName (read only) | partial: no self write; these are HR-owned (`PUT /v1/hrms/employees/{id}` needs `hrms.employee.write`) (Q2) |
| M4 | **Email** with tick (read-only) | `users/me.email`; tick = activation | exists / partial |
| M5 | **Mobile** | `users/me.phone` = `auth.user_credentials.mobile_number` ("Used for account recovery only"); `PUT /v1/users/me {phone}` | exists. It is not the HR record's phone (Q2) |
| M6 | **Current city** | none. The person can't read or write their own addresses: `GET /v1/employees/{self}/profile/addresses` → 403 for reader | missing (G-P5b/c) |
| M7 | **Emergency contact** ("Add someone to call") | `GET` and `POST /v1/employees/{id}/emergency-contacts` allow SELF (EmployeeController L463–487) | partial: the person can't update or delete their own contact |
| MA1 | **Update** (disabled until something changes) | `PUT /v1/users/me` (displayName, phone, notificationPreferences) | partial: covers M5 (and display name) only |

Today's `/profile` also has fields the design's card doesn't show; keep them.
- Display name.
- Face enrollment for yourself ("Enroll my face" / "Re-enroll").
- Approval delegation ("+ Add delegation", From/To).
- My documents (upload / re-upload with Issued / Expires).
- Notifications: email and push switches, plus choices per event for email, in-app and push.
- The "On this page" list, the unsaved-changes bar, "Save settings" and "Discard".

### 3.5 Overview tab

HR view (the prototype's cards, in order):

| # | Data point | Source today | Status | Gate today |
|---|---|---|---|---|
| O1 | Stat **This week**: "26h 40m", "of 45h scheduled" | `useEmployeeWeeklySummary` → `totalHours`, `dailyTargetHours`, `days[].status` | exists ("scheduled" = target × working days, computed) | `attendance.team.read` (+ self / manager / admin scope) |
| O2 | Stat **Annual CTC**, "since <effective date>" (the prototype's per-person variant; its default shows **Leave balance**, "casual and earned") | `useEmployeeStructure` → `ctcAnnual`, `effectiveFrom`; leave: `GET /v1/leave/employees/{id}/balances` | exists | `payroll.structure.read`; leave: `hrms.leave.employee.read` / team `hrms.leave.approve.l1` / self |
| O3 | Stat **Documents** "5 of 7", "2 waiting for review" | `useEmployeeDocuments` (paged, 10 rows) → `totalElements`, status on each row | partial: no counts by status (G-P7) | `hrms.document.read` |
| O4 | Stat **Goals** "4 of 6", "on track this cycle" | `useEmployeeKpis` (today `activeOnly`, size 1 → total); the full list (size 50) has statuses | partial: the on-track count is computed from at most 50 rows | `hrms.performance.read` |
| O5 | **Employment**: Designation, Department, Employment type, Company, Work location, Joined, Probation ("Completed <date>" / "Ends in N weeks"), Reports to, Shift (name · times), plus an **Edit** link | workforce record + org lists + by-ids + `useEmployeeShift` | exists | record `hrms.employee.read`; shift `attendance.team.read` or `attendance.workforce.admin`; Edit `hrms.employee.write` |
| O6 | **Needs attention**: rows with a tone dot, title, sub-line and CTA | today's rules: probation ≤ 30 days, notice, no salary structure, no shift, absent days this week (EmployeeDetail L155–165) | exists. The design adds: a day with no punch-out (from the weekly summary); "N documents to review" (G-P7); "Self-review due <date>" (from `GET /v1/performance/employees/{id}`, partial) | per source |
| O7 | **This month** mini calendar: present, late, absent, on leave, work from home, no punch-out, week off, today; legend; link "Attendance" | none for one employee (the weekly summary covers one week) | **missing** (G-P1) | `attendance.team.read` + object scope |
| O8 | **Account**: "Account active", or invitation sent / not invited | `GET /v1/employees/{id}/invitation-status` | exists | self, `hrms.employee.read`, or any direct manager |
| O9 | Last sign-in "Today 09:21 · Android" | `invitation-status.lastLoginAt` | partial: the device is not returned (G-P6) | as O8 |
| O10 | Face check-in "Enrolled 14 Mar 2022" + **Reset face enrollment** | face admin `enrollment-status` → `enrolledAt`; reset endpoint | exists | `attendance.face.admin.reset` |
| O11 | *(keep; not in the design)* Onboarding record: hire details, assets, policies, checklists | `GET /v1/hrms/employees/{id}/onboarding-record` | exists | `hrms.employee.write` |
| O12 | *(keep)* Probation banner with Confirm / Extend | record | exists | `hrms.employee.write` |

Overview actions: tiles open their tab (client); Employment **Edit** (LA1); calendar "Attendance" link → the Attendance tab; attention CTAs → their tabs; Reset face (O10); *(keep)* Enroll face, Send/Resend invitation.

My profile, what changes:
- **O1:** `GET /v1/attendance/weekly-summary` (`attendance.checkin.self`).
- **O2:** `GET /v1/payroll/structures/me` (`payroll.structure.read.self`).
- **O3:** `GET /v1/document/my` (statuses per document; `hrms.document.read.self`).
- **O4:** `GET /v1/performance/goals/my`.
- **O5:** from `GET /v1/employees/me`. Partial: no probation or confirmation dates in that response, and no manager name, because by-ids needs `hrms.employee.read` (G-P5a). Hide **Edit**: these fields are HR-owned.
- **O6:** `GET /v1/document/my/missing`, `GET /v1/performance/reviews/my`, own history.
- **O7:** `GET /v1/attendance/history?year&month` + `/monthly-stats` (exist).
- **O9:** `invitation-status` allows SELF.
- **O10:** own face status, with **Enroll my face / Re-enroll** (exists) instead of the admin-only Reset. The prototype wrongly shows Reset on My profile.
- **For OWNER/ADMIN/SUPER_ADMIN/COMPANY_ADMIN:** hide O1 and O7 (the My Attendance rule).

### 3.6 Personal tab (HR view)

| # | Data point | Source | Status | Gate |
|---|---|---|---|---|
| P1 | **Contact & addresses** ("How to reach <first name>"): Work email, Phone, Date of birth, Gender, Current address, Permanent address; action **Add Address** | record + `GET /v1/employees/{id}/profile/addresses` (type CURRENT, PERMANENT or OFFICE) | exists | `@perm.check('hrms.employee.profile.read')`; add/delete `hrms.employee.profile.write` |
| P2 | **Identity documents** ("Masked. Only HR admins can reveal them"): PAN, Aadhaar (masked), UAN, ESIC number, Passport number, Passport expiry | `GET …/profile/identity` (PiiField reveal toggles) | exists. The copy should say what really gates it (C-P8) | `hrms.employee.identity.read`; *(keep)* Save Identity form `hrms.employee.identity.write` |
| P3 | **Education** rows: "<degree> · <field>", institution, years, grade pill; **Add Education** | `GET …/profile/education` | exists | profile.read / profile.write |
| P4 | **Work experience** rows: "<designation> · <company>", "<location> · <description>", dates; **Add Experience** | `GET …/profile/experience` (companyName, designation, location, description, startDate, endDate, current) | exists | same |
| P5 | **Dependents** ("Nominee share must add up to 100%"): "<name> · <relation>", born, "Nominee N%" pill; **Add Dependent** | `GET …/profile/dependents` (nominee, nomineePercentage) | exists. Partial: the total isn't checked anywhere; the only check is 0–100 on each row (G-P12) | same |
| P6 | **Emergency contacts** rows: "<name> · <relation>", "<phone> · <email>"; **Add Emergency Contact** | `GET …/profile/emergency-contacts` | exists | same |

Actions all exist:
- `POST` / `DELETE` on addresses, education, experience, dependents and emergency contacts
- `PUT` identity.

Add, save and delete buttons are shown only with the write permission; delete buttons are kept. Date fields use `DateField` from `shared/components/calendar`, as today.

### 3.7 Job tab

| # | Data point | Source | Status | Gate |
|---|---|---|---|---|
| J1 | **Employment details**: Department, Designation, Branch, Employment type, CTC (annual), Joining date, Confirmation date, Probation end, Last working day; **Edit Work Details** | record + org lists; CTC only with `payroll.structure.read` | exists | read `hrms.employee.read`; edit `hrms.employee.write` → `PUT /v1/hrms/employees/{id}` |
| J2 | **Reporting line**: the manager row ("Reports to · <designation>", Manager pill; click opens their profile) | by-ids + designations | exists | `hrms.employee.read` |
| J3 | **Reporting line**: direct reports ("Direct report · <designation>", status pill such as Probation) | none | **missing** (G-P3) | — |
| J4 | **Assigned shift**: Shift, Timing "<start>–<end> · N min grace", Next shift ("Same from Mon, 28 Sep" / the upcoming change); **Change shift** | `useEmployeeShift` → `shiftName`, `startTime`, `endTime`, `gracePeriodMinutes`, `upcomingShiftName`, `upcomingEffectiveFrom` | exists | `attendance.team.read` (read), `attendance.workforce.admin` (change) |

Note: today's Edit Work Details takes "Reporting Manager ID" as a raw UUID. The redesign should use a people picker (Dropdown with search over the directory). Frontend only; the field is already accepted.

### 3.8 Attendance tab

| # | Data point | Source | Status |
|---|---|---|---|
| T1 | Month title and summary "17 present · 3 late · 1 absent · 2 on leave · 1 incomplete" | none for one employee | **missing** (G-P1) |
| T2 | Legend (Present, Late, Absent, On leave, Week off) | client | client |
| T3 | Month grid (64 px cells with the status label) | none for one employee | **missing** (G-P1) |
| T4 | *(keep)* This week, records table with "Punched by", shift and shift history, status-change history, assisted punches | weekly-summary, `/employee/{id}/records`, shift history, `status-history`, assisted punches | exists; `live-w3-punch.mjs` asserts "Punched by …" here |

Gate: `attendance.team.read` + `assertCanReadEmployeeAttendance` (self, direct manager, attendance admin). FINANCE_LEAD holds `attendance.team.read` but gets 403 for people who aren't their reports (seen live), so the tab shows its no-access state.

### 3.9 Payroll tab (HR) / My pay (self)

| # | Data point | Source | Status | Gate |
|---|---|---|---|---|
| Y1 | **Salary structure**: "Monthly · effective <date> · <new/old> tax regime", CTC | `useEmployeeStructure` → `effectiveFrom`, `taxRegime`, `ctcAnnual` | exists | `payroll.structure.read` |
| Y2 | Earnings lines + **Gross** | `earnings[]`, `grossMonthly` (server-computed) | exists | same |
| Y3 | Deductions lines + **Total deductions** | `deductions[]`, `totalDeductions` | exists | same |
| Y4 | **Net pay per month** (count-up) | `netMonthly` | exists | same |
| Y5 | **Payslips** list: month, "Paid <date> · N LOP", net; click opens the payslip | none for one employee | **missing** (G-P2) | would be `payroll.runs.read` |
| Y6 | *(keep)* structure history; bank accounts (add/delete); set up / revise the structure | `useStructureHistory`, `useBankAccounts`, `POST /v1/payroll/structures` | exists | `payroll.structure.read`, `hrms.employee.bank.read`/`.write`, `payroll.structure.manage` |

Opening a payslip from Y5 uses the existing `GET /v1/payroll/runs/{runId}/employees/{empId}/payslip` (+ `.pdf`) (`payroll.runs.read`).

**My pay (self):** `GET /v1/payroll/structures/me`, `GET /v1/payroll/payslips/me`, `/payslips/me/{runId}` (+ `.pdf`) — all exist (`payroll.structure.read.self`, `payroll.payslip.read.self`).

### 3.10 Leave tab

| # | Data point | Source | Status |
|---|---|---|---|
| V1 | **Balances** ("Available after pending requests"): "<available> of <total>" per type | `GET /v1/leave/employees/{id}/balances?year` (available, used, pending, totalEntitlement, carryForward) | exists |
| V2 | **Leave requests** (count badge; "Newest first, with where each one stands."): "<type> · N days", "<dates> · <reason>", when applied, status pill | `GET /v1/leave/employees/{id}/requests` (paged) | exists |

| Action | API | Status | Permission |
|---|---|---|---|
| **Apply on behalf** | none: `POST /v1/leave/apply` always uses the caller's own id | **missing** (G-P8 = leave-payrun.md L8) | would be the new `hrms.leave.apply.others` |
| Inline **Approve** on pending rows | `POST /v1/leave/{id}/decision` (`useLeaveDecision`); the server checks the approver | exists | `hrms.leave.approve.l1` (+ approver scope) |
| *(keep)* Open Leave centre | navigate `/hrms/leave` | exists | — |

Read gate: `hrms.leave.employee.read` (anyone), `hrms.leave.approve.l1` (team), or self. **My profile:** the same endpoints work for self. The action there is **Apply leave** (`POST /v1/leave/apply`, `leave.request.self`), not "Apply on behalf".

### 3.11 Expenses tab

| # | Data point / action | Source / API | Status | Gate |
|---|---|---|---|---|
| E1 | **Expense claims** ("Submitted by <first> this year"): "<title> · ₹amount", "<date> · <note>", status | `GET /v1/expense/employees/{id}/claims` | exists | `hrms.expense.employee.read`, team `hrms.expense.claim.approve`, or self |
| E2 | **New claim** on someone else's profile | none: `POST /v1/expense/claims` is self only | **missing** (G-P9) | would be a new `hrms.expense.claim.others` |
| E3 | **New claim** on My profile | `POST /v1/expense/claims` (+ receipts) | exists | `hrms.expense.claim.self` |
| E4 | *(keep)* open a claim: line items, receipts (signed links) | `GET /v1/expense/claims/{id}` | exists | — |

### 3.12 Documents tab

| # | Data point / action | Source / API | Status | Gate |
|---|---|---|---|---|
| F1 | **Filed documents** ("Verify each one before payroll uses it", count badge): title, "Uploaded <date>" / note, status pill (Verified / Pending / Rejected / Expired) | `GET /v1/document/employee/{id}` (paged; Expired from `expiryDate`) | exists | `hrms.document.read` |
| F2 | **Upload** | `POST /v1/document/upload` (multipart: file + metadata {employeeId, title, documentTypeId, issuedDate, expiryDate, notes}); an HR upload is saved as VERIFIED | exists. The page links to the Document Vault today, so reuse the Vault's form in a SidePanel | `hrms.document.write` |
| F3 | Inline **Reject** / **Mark verified** on pending rows | `POST /v1/document/documents/{id}/reject` / `…/verify` | exists | `hrms.document.verify` |
| F4 | **My profile**: my documents, upload | `GET /v1/document/my`, `POST /v1/document/upload/self` (saved as PENDING) | exists | `hrms.document.read.self`, `hrms.document.write.self` |

### 3.13 Letters tab

| # | Data point / action | Source / API | Status | Gate |
|---|---|---|---|---|
| R1 | **Generated letters**: title, "Signed <date>" / "Issued <date>" | `GET /v1/letters/generated?employeeId=` (type, subject, status incl. SIGNED, createdAt, sentAt, viewedAt) | partial: no signed date in the response, although `letters.generated.signed_at` exists (V032) (G-P11) | `hrms.letters.read` |
| R2 | **Download** per row | `GET /v1/letters/generated/{id}/pdf` | exists | `hrms.letters.read` or `.read.self` |
| R3 | **Generate letter** | navigate `/hrms/letters/generated?employeeId=` | exists | `hrms.letters.generate` |
| R4 | **My profile**: my letters | `GET /v1/letters/my` | exists | `hrms.letters.read.self` |

### 3.14 Performance tab

| # | Data point / action | Source / API | Status | Gate |
|---|---|---|---|---|
| K1 | **Goals & KPIs** ("What this employee is currently measured on."): title, "Due <date>" / "Done", %, bar | `GET /v1/performance/kpis?ownerId=` | exists | `hrms.performance.read` |
| K2 | **Add goal** | `POST /v1/performance/kpis` `{ownerId, title, …, dueDate}` | exists | `hrms.kpi.manage` |
| K3 | **Reviews**: "<cycle> · manager review", "By <reviewer>", "4.6 / 5", status | `GET /v1/performance/employees/{id}` (team-scoped for managers) | exists | `hrms.performance.read` |
| K4 | **Skills & certifications** chips; **Add skill** | `GET /v1/learning/skills/{id}`; `POST /v1/learning/skills` | exists | `hrms.learning.skill.read`; `hrms.learning.write` |
| K5 | **My profile** | `GET /v1/performance/goals/my`, `/reviews/my`, `/v1/learning/skills/me`; self skill: `POST /v1/learning/skill-assessments` | exists | `hrms.performance.review.self`, `hrms.learning.enroll.self` / `.skill.assess.self` |

### 3.15 Exit tab (HR only)

| # | Data point / action | Source / API | Status |
|---|---|---|---|
| X1 | **Current standing**: Status, "Notice period 60 days", Serving notice until | record; days = HR configuration `defaultNoticePeriodDays` (company-wide) | partial: the days are the company default, not per person, and are readable only with `settings.read` / `settings.hrconfig.write` / `hrms.employee.write` / `attendance.policy.manage` |
| X2 | **Lifecycle** steps: Joined, Probation ends, Confirmed, Notice started (+ Last working day / Exited) | record | exists |
| X3 | **Separation details** ("Last working day must be on or after the notice start date."): Notice start date, Last working day, Exit type, Reason; **Edit separation details** | record; `PUT /v1/hrms/employees/{id}` | exists (`hrms.employee.write`) |
| X4 | **Full & final settlement** ("Starts once a last working day is set." / its state) | `GET /v1/fnf/settlements` (paged, no employee filter); a link to `/hrms/fnf` today | partial (G-P10); `hrms.fnf.read` |

### 3.16 My profile, tab by tab (data sources for the signed-in person)

| Tab | Source | Status |
|---|---|---|
| Overview | §3.5 (self) | exists / partial (O5 dates, manager name; O9 device) |
| Personal | Only emergency contacts can be read by oneself (`/v1/employees/{id}/emergency-contacts`). Addresses, education, experience, dependents and identity return 403 for reader (checked live) | **missing** (G-P5b) |
| Job | `GET /v1/employees/me` (jobTitle, type, status, joined, department, branch, managerId, workLocation); own shift `GET /v1/shifts/employee/{self}` | partial: no probation, confirmation, notice or last-working-day dates, and no manager name (G-P5a). Direct reports for a manager's own profile: G-P3 |
| Attendance | `GET /v1/attendance/history`, `/monthly-stats`, `/weekly-summary` | exists. Hidden for OWNER/ADMIN/SUPER_ADMIN/COMPANY_ADMIN |
| My pay | `structures/me`, `payslips/me` | exists |
| Leave | `/v1/leave/employees/{self}/…` or `/v1/leave/my…`; Apply `POST /v1/leave/apply` | exists |
| Expenses | `/v1/expense/employees/{self}/claims`; New claim | exists |
| Documents | `/v1/document/my`, `/my/missing`, `upload/self` | exists |
| Letters | `/v1/letters/my`, PDF | exists |
| Performance | `goals/my`, `reviews/my`, `skills/me` | exists |

Tabs should appear by self permission:
- Attendance: `attendance.checkin.self` (and not an admin role)
- My pay: `payroll.structure.read.self` or `payroll.payslip.read.self`
- Leave: `leave.request.self`
- Expenses: `hrms.expense.claim.self`
- Documents: `hrms.document.read.self`
- Letters: `hrms.letters.read.self`
- Performance: `hrms.performance.review.self`
- Personal: after G-P5b
- Overview and Job: a signed-in person with a linked employee record.

An account with no employee record (platform admins) keeps today's empty state: "No employee record linked to this login".

### 3.17 Permissions today (profiles)

- **HR view route.** App.tsx L334–344: `<RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ, P.ATTENDANCE_TEAM_READ]}><ModuleGate moduleKey="hrms">`.
  - There is no registry entry (the path is dynamic). The rail lights Master because `matchPath('/hrms/employees')` matches.
  - `ownsSectionBar` hides the shell's sub-nav on `/hrms/employees/:id` (PlatformShell L349).
- **The record.** `GET /v1/hrms/employees/{id}` has `@PreAuthorize("hasAuthority('hrms.employee.read')")`.
  - The route comment says a manager may open a direct report, but a DEPT_MANAGER gets 403 on the record, so the page shows its error state (checked live: mgr → 403 for their own report, reader).
  - The older `GET /v1/employees/{id}` returns 200 for the same manager.
- **UI flags** (EmployeeDetail L77–85):
  - `canWrite` = `hrms.employee.write`
  - `canInvite` = `hrms.employee.invite`
  - `canFace` = `attendance.face.admin.reset`
  - `canShift` = `attendance.workforce.admin`
  - `canPii` = `hrms.employee.profile.read`
  - `canIdentity` = `hrms.employee.identity.read`
  - `canAttendance` = `attendance.team.read`
  - `canSalary` = `payroll.structure.read`
  - `canBank` = `hrms.employee.bank.read`
  - `canDocs` = `hrms.document.read`
  - `canLetters` = `hrms.letters.read`
  - `canPerf` = `hrms.performance.read`
  - `canSkills` = `hrms.learning.skill.read`
  - `canLeave` / `canLeaveTeam` = `hrms.leave.employee.read` / `hrms.leave.approve.l1`
  - `canClaims` / `canClaimsTeam` = `hrms.expense.employee.read` / `hrms.expense.claim.approve`
  - `self` = the viewer's own employee id.
- **Tabs** (EmployeeDetail L286–298):
  - Personal: `canPii || canIdentity`
  - Job: always
  - Attendance: `canAttendance`
  - Payroll: `canSalary || canBank`
  - Leave: `canLeave || canLeaveTeam || self`
  - Expenses: `canClaims || canClaimsTeam || self`
  - Documents: `canDocs` (badge = total)
  - Letters: `canLetters`
  - Performance: `canPerf || canSkills`
  - Exit: always
  - An unknown `?tab=` falls back to Overview.
- **Endpoint gates.** Each section's endpoint gate is listed in its own table above.
- **My profile.**
  - `/profile` has no route guard (App.tsx L230).
  - Registry: `page('profile', 'My profile', '/profile', 'Me', 'me/profile', [], { aliases: ['profile', 'settings/profile'] })`.
  - `MENU_RULES['/profile'] = []`; `SETTINGS_NAV` `s-profile` → `/profile`.
  - Self endpoints are `isAuthenticated()` (`/v1/users/me`, `/v1/employees/me`, `invitation-status` for self) or self permissions (listed in §3.16).
- **Who holds them.** Every self permission is held by all system roles. `hrms.employee.profile.read` / `.identity.read` / `.bank.read`, `hrms.document.read` and `hrms.leave.employee.read` are held by OWNER, SUPER_ADMIN, ADMIN and HR_MANAGER.

### 3.18 Gaps and the backend work they need

| ID | Gap | Backend work | Schema | JPA-mapped table | Size |
|---|---|---|---|---|---|
| G-P1 | Month calendar for one employee (Overview "This month", Attendance tab) | `GET /v1/attendance/employee/{employeeId}/history?year&month` and `…/monthly-stats`: `attendance.team.read` + the existing `assertCanReadEmployeeAttendance`; reuse `AttendanceService.getMonthHistory` / `getMonthlyStats` (the effective-status path). Tests; hook `useEmployeeMonthHistory`. | No | reads `attendance.records` (JPA) | S |
| G-P2 | Payslip list for one employee | `GET /v1/payroll/employees/{employeeId}/payslips` (`payroll.runs.read`), reusing `listMyPayslips(tenant, employeeId)` (locked or paid runs). Rows open the existing run payslip. | No | reads payroll runs (existing) | S |
| G-P3 | Direct reports | Add a `reportingManagerId` filter to `GET /v1/hrms/employees` (`WorkforceFilter` + query; list projection, no CTC). For the manager's own My profile: a self-scoped list. | No | `hrms.employees` | S |
| G-P4 | A manager can't open a report's profile (route allows it, API 403) | `GET /v1/hrms/employees/{id}`: also allow the direct manager holding `hrms.employee.team.manage` (same rule as `EmployeeController.assertCanAccessEmployee`). Return the list projection with CTC, bank, UAN, ESI and salary nulled. Tests for field masking. | No | `hrms.employees` | M |
| G-P5a | Own workforce record for My profile | `GET /v1/hrms/employees/me` (authenticated; list projection: probation, confirmation, notice, last working day, designation id) plus the manager's display name. | No | `hrms.employees` | S |
| G-P5b | Own personal sections (My profile → Personal) | In `EmployeeProfileController`, allow SELF to read addresses, education, experience, dependents and emergency contacts, and a masked identity (an object-scope guard "self or `hrms.employee.profile.read`"). Self writes depend on Q2. | No | `hrms.employee_addresses` etc. (JPA; unchanged) | M |
| G-P5c | Own editable fields in the My profile card: first/last name, current city, emergency-contact update/delete | Self endpoints, if Q2 allows: `PATCH /v1/employees/me/names`, a self CURRENT address, `PUT`/`DELETE /v1/employees/{self}/emergency-contacts/{id}`. | No | `hrms.employees`, `hrms.emergency_contacts` (JPA) | S–M |
| G-P6 | Last sign-in device | Add `lastLoginDevice` to `GET /v1/employees/{id}/invitation-status`, from the newest `auth.refresh_tokens.user_agent` for that login (JDBC), shown as "Android", "iPhone" or "Chrome on Windows". | No | read only | S |
| G-P7 | Document counts by status (Documents stat, "N documents to review") | Add status counts (verified, pending, rejected, expired) to `GET /v1/document/employee/{id}` and `/v1/document/my` (or a `/summary`). | No | read only | S |
| G-P8 | Apply leave on behalf (Leave tab) | Shared with leave-payrun.md L8: `POST /v1/leave/apply/for/{employeeId}` (same checks and approver chain), notify the employee. New permission `hrms.leave.apply.others` in a migration that grants it to OWNER and SUPER_ADMIN (OwnerPermissionInvariantCheck), plus ADMIN and HR_MANAGER. | Permission rows only (no table/column) | `leave_mgmt.leave_requests` (unchanged) | M |
| G-P9 | New claim for someone else (Expenses tab) | `POST /v1/expense/claims/for/{employeeId}` + receipts on behalf, following the advance-on-behalf pattern (V143_24). New permission `hrms.expense.claim.others` (migration as in G-P8). Or show "New claim" only on My profile (Q4). | Permission rows only | `expense_mgmt` claims (unchanged) | M |
| G-P10 | F&F state for one employee (Exit tab) | `employeeId` filter on `GET /v1/fnf/settlements` (`hrms.fnf.read`). | No | read only | S |
| G-P11 | Letter signed date | Expose `signedAt` (column `letters.generated.signed_at`, V032) in the generated-letter response. Read it with JDBC so no JPA mapping changes (DECISIONS 2). | No | letters entity (unchanged) | S |
| G-P12 | Nominee share total ("must add up to 100%") | Refuse a dependent whose nominee share takes the employee's total above 100%; show the running total. | No | `hrms.employee_dependents` (JPA; unchanged) | S |
| G-P13 | Banner asset and dark mode | Copy `profile-banner.png` into the app's assets; give dark mode a dim overlay. | No | — | S (frontend) |

### 3.19 Conflicts with today's behaviour and earlier decisions

- **C-P1. Where My profile lives (Q1).**
  - `/profile` today is the SettingsKit account page: Photo & contact, Face enrollment, Employment, Personal details, Approval delegation, My documents, Notifications (+ Email / In-app / Push choices). It is also the Settings row's "Profile" tab, and ⌘K maps `settings/profile` to it.
  - DECISIONS 11: More → Settings → Preferences opens the first settings page the person can open, and every settings page keeps its URL.
  - Seven live tests assert its sections, the "On this page" list (6 links), "Save settings" / "Discard" and the `#st-face` / `#st-delegation` anchors.
  - The design's My profile has none of the preference sections.
  - Recommended option A: draw the new layout at `/profile` and keep every current section reachable on the same URL:
    - photo on the avatar
    - display name and contact phone in the left card
    - Employment in Overview / Job
    - My documents in Documents
    - self face enrollment in the Account card
    - Approval delegation and Notification choices in one added **Preferences** tab (`/profile?tab=preferences`) that keeps the same `#st-…` ids.
  - Option B: the new layout at a new URL (e.g. `/me/profile`), with `/profile` unchanged as the Preferences page.
- **C-P2. My Attendance is hidden for OWNER/ADMIN/SUPER_ADMIN** (and COMPANY_ADMIN, DECISIONS 11). The prototype's admin My profile shows an **Attendance** tab and the "This month" and "This week" cards. For administrators, hide the Attendance tab, the This month card and the This week stat.
- **C-P3. Lifecycle actions depend on the status.** The design shows only Edit profile, Change shift and Start notice. Today, by status:
  - Probation: Confirm, Extend, Start notice
  - Active: Start notice
  - Notice period: Cancel notice, Mark exited
  - also Send/Resend invitation and face Enroll/Reset.
  
  Keep them all. Make the 2-up row follow the status (for example, notice period → Cancel notice / Mark exited). Put the rest in a small "More actions" menu and in the Needs-attention CTAs (probation Confirm / Extend). No status should lose an action.
- **C-P4. Onboarding record and probation banner** exist today and aren't in the design. Keep the onboarding record (for example under Needs attention on Overview). The banner can become a Needs-attention row with its two buttons.
- **C-P5. Self-edit fields (Q2).** The design lets people edit their own first name, last name, current city and emergency contact. Today they can change only display name, contact phone, photo and notifications; names and addresses are HR-owned. "Mobile" on My profile is the login's recovery phone, not the HR record's phone.
- **C-P6. The design's Overview is identical for self** and shows HR actions (Employment "Edit", "Reset face enrollment"). Gate by permission: self gets Enroll/Re-enroll, and no Edit.
- **C-P7. Face reset copy.** Keep the corrected text from commit `e32a4dc6`: "This deletes the stored face templates and clears any verification lockout. Face punch-in stops working … until they enrol again — from the mobile app, or with Enroll face here". The design's "They enrol again on the mobile app" is out of date.
- **C-P8. Identity card copy.** The design says "Only HR admins can reveal them". The real rule is a permission (`hrms.employee.identity.read`), and the page deliberately doesn't claim the reveal is audited. Keep the accurate wording.
- **C-P9. Documents "Upload".** Today the tab is read-only by design and links to the Document Vault, so that one form owns the category and expiry rules. If Upload is added here, reuse that form; don't write a second one.
- **C-P10. Labels.** "Edit employee" becomes "Edit profile", the "Actions" menu goes, and the tabs stop being `role=tab`. Update the selectors in the live tests (§4) and keep the checks. Keep ARIA tab semantics.
- **C-P11. First-name copy.** Copy that uses the first name ("How to reach Priya", "Submitted by Priya this year") must use `greetingName()` (the full name when the first name has fewer than 2 letters).
- **C-P12. Dates.** Every date field in these panels and dialogs keeps `DateField` from `shared/components/calendar`, as today. `live-w3-r1.mjs` asserts `.utc-trigger`.
- **C-P13. Rail.** `/hrms/employees/:id` keeps lighting Workforce (Master). My profile lights More, like the settings pages (DECISIONS 11, `railLit`).
- **C-P14. Width and font.** 1440 and Plus Jakarta Sans vs `DesignFrame`'s 1320 and Inter.

### 3.20 Components

- **From the shared kit:** Avatar (with presence dot), StatusPill, StatCard (the Overview stats), Card/Section, ListRow, ApprovalRow (compact inline Approve in the Leave tab; Reject/Mark verified in Documents), MonthCalendar (mini on Overview, full with labels on Attendance, legend), Meter/ProgressBar (goals), EmptyState, Skeleton, Toast, Popover/Menu ("More actions"), Dropdown with search (reporting-manager picker, document type), SidePanel (Edit profile Basic/Financial, Change shift, Add address/education/experience/dependent/contact, Edit separation details, Upload document, Add goal, Add skill), Dialog (lifecycle, face reset), FormField (input, select, textarea, toggle, with `DateField` for dates), PillTabs (single-pill header state).
- **Page-specific:** ProfileBanner, the left profile card (field rows with icons: read-only and editable variants, verified tick, primary button plus a 2-up row), in-card underline tabs (ARIA tablist), the PgProfileTabs section kinds (key-value grid, rows with a monogram, steps timeline, chips, dashed empty box), AccountCard, AttentionList (tone dot + CTA), Payroll net-pay band.

### 3.21 Risks

- **Seven live tests assert today's profile markup**: `live-design-workspace`, `live-w3-r1`, `live-employee-exit`, `live-w3-faceenroll`, `live-dead-entrypoints`, `live-w3-punch` and `live-w3-search`. Seven more assert `/profile` (§4). The `/profile` decision (Q1) decides how many of them change.
- **Opening data up.**
  - Letting managers read the record (G-P4) or people read their own personal sections (G-P5b) is a privacy change: every sensitive field needs a masking test.
  - A per-employee payslip list (G-P2) must stay behind `payroll.runs.read`.
- **Reset face.** It depends on the login-id fix in `e32a4dc6`: an employee with no login gets a 409 with a plain sentence (`faceErrorText`). Keep that path.
- **Generated view.** `EmployeeWorkspace.view.tsx` is generated by `scripts/design-build.mjs`, the same issue as §2.9.
- **Dark mode.**
  - The banner is a light illustration with no dark version.
  - REDESIGN_RULES says the design's own dark profile card is incomplete, so follow the tokens.
- **Paging.**
  - The Overview counts for documents and goals would be wrong if computed from one page (10 documents, 50 goals); G-P7 avoids that.
  - The per-tab sections page their own lists; keep the paging.
- **Other roles.**
  - FINANCE_LEAD sees Attendance as no-access for people who aren't their reports (the frontend flag is broader than the server scope). Keep the no-access state.
  - A manager's view depends on G-P4.

---

## 4. Tests that assert today's markup or behaviour here

Update selectors when the markup changes; keep every behavioural check (REDESIGN_RULES "Tests").

**Companies**

| File | What it asserts |
|---|---|
| `apps/platform/e2e/recovery/live-design-companies.mjs` | "Statutory information", "Add branch", "Create branch", placeholders (e.g. Mumbai Office / MUM / Mumbai / Registered legal name), `select` "Select state", `article` card "On · 100 m", Manage → "Edit branch", "Mark as headquarters", "Save changes", "Headquarters", Archive + dialog, Edit → "Edit company", "Save format" + toast |
| `apps/platform/e2e/recovery/live-company-restore.mjs` | `aside[aria-label="Companies"]`, `button[aria-labelledby="co-pick-label"]`, label "Search companies", `role=option`, status dropdown with options, heading "Archived companies", `article` + `h4`, Table/Cards, every confirm and guard sentence, the tooltip, phone checks, API and DB checks |
| `apps/platform/e2e/recovery/live-mobile-layout.mjs` | `/hrms/companies` has no sideways scroll at phone width |
| `apps/platform/e2e/recovery/live-design-attendance-admin.mjs` | the geofencing URL redirects to `/hrms/companies` |
| `live-w1a.mjs`, `live-w3-punch.mjs`, `live-w1g.mjs`, `live-onboarding.mjs` | geofence flag / OUTSIDE_GEOFENCE / geofence save permissions / the "Local QA Office" fixture (switch off, HQ). Affected only if G-C1 changes behaviour |
| `live-w1e.mjs`, `live-w2c.mjs`, `live-backend-fixes.mjs`, `live-api.mjs` | API/DB only (company and branch rules) |

**Profiles**

| File | What it asserts |
|---|---|
| `apps/platform/e2e/recovery/live-design-workspace.mjs` | Header code + "Probation"; "Probation ends in 10 days"; no shell sub-tabs; "Edit employee" → "Next: Financial →" → "Save changes"; "Extend", "Confirm as permanent"; "Actions" menu → "Start notice" / "Cancel notice"; "Change shift" → "Save shift"; every tab via `role=tab` |
| `apps/platform/e2e/recovery/live-w3-r1.mjs` | dialog "Edit employee", `.utc-trigger`, "All fields…", "Edit Employee" full form, "Actions" → "Confirm probation", dialog "Confirm Probation", dialog "Change employee shift", "Schedule shift change"; `?tab=personal` "Passport Expiry", "Save Identity", "Add Experience", "Add Dependent", "Close panel"; `?tab=payroll`, `?tab=exit` |
| `apps/platform/e2e/recovery/live-employee-exit.mjs` | `?tab=exit`, "Edit separation details", "Separation reason", "Save separation details", "Actions" → "Mark exited", "Mark Employee as Exited" |
| `apps/platform/e2e/recovery/live-w3-faceenroll.mjs` | `/profile` `#st-face`, "Face enrollment" heading, "Enroll my face" / "Re-enroll"; employee page "Face enrollment", "Enroll face" / "Re-enroll face", "Not enrolled", the drawer headings |
| `apps/platform/e2e/recovery/live-dead-entrypoints.mjs` | workspace tab `role=tab` /^Expenses/, "Open Expenses" |
| `apps/platform/e2e/recovery/live-w3-punch.mjs` | `?tab=attendance` shows "Punched by …" |
| `apps/platform/e2e/recovery/live-w3-search.mjs` | result URLs `/hrms/employees/{id}?tab=leave` / `?tab=documents` |
| `apps/platform/e2e/recovery/live-design-settings.mjs` | `/profile` headings Employment, Personal details, Approval delegation, My documents, Notifications; "On this page" (6 links); "Contact phone", "Fix 1 error to save", "1 change · not saved yet", "Save settings", switch "Push notifications", "Discard", `#st-delegation`; reader "Personal details" |
| `apps/platform/e2e/recovery/live-settings-restored.mjs` | `/profile` "On this page" item "Face enrollment"; phone on `/profile` |
| `apps/platform/e2e/recovery/live-w3-r3.mjs` | `/profile` my-documents `.ut-card`, Upload / Re-upload, "Issued" / "Expires" |
| `apps/platform/e2e/recovery/live-w3-r4.mjs` | `/profile` "+ Add delegation", From / To |
| `apps/platform/e2e/recovery/live-rail-highlight.mjs` | uses `/profile` as the page no rail item owns |
| `apps/platform/e2e/recovery/capture-design-screens.mjs` | `/profile` in its screenshot list |

**Unit tests**
- `src/shared/navigation/pageRegistry.test.ts`: `/hrms/companies` is open for HR and closed for a department manager; `/profile` is open for an employee.
- `src/shared/search/search.test.ts`: `/geofence` and `/attendance/geofencing` → `/hrms/companies`.

**Backend tests** (only if those services change)
- `BranchHeadquartersTest`, `CompanyArchiveAuditTest`, `CompanyArchiveRestoreTest`, `MasterOrgServicesTest`, `CompanyFiscalYearTest`
- `AssistedPunchScopeTest` (G-C1)
- `RbacMatrixIT`, `RbacEnforcementIT`, `CrossTenantIsolationIT` (new endpoints and permissions)

---

## 5. Open questions

1. **My profile location (C-P1).** Option A (recommended): the new tabbed layout at `/profile`, keeping every current section there, with Approval delegation and Notification choices in an added **Preferences** tab that keeps the `#st-…` anchors. Option B: the new layout at a new URL, with `/profile` staying the Preferences page. Which?
2. **Self-edit.** May people edit their own first name, last name, current city and emergency contact from My profile, as the design shows? Or should these stay read-only and HR-owned, as today, with only display name, contact phone and photo editable? And should "Mobile" there be the login's recovery phone (today) or the HR record's phone?
3. **Per-branch check-in switch.** Should turning "Only allow check-in inside this area" off really stop that branch's punches from being checked and flagged (a backend change for every tenant)? Or should the switch keep today's meaning, with its copy changed to say what it does?
4. **On-behalf actions on another person's profile.** "Apply on behalf" (Leave) and "New claim" (Expenses): build them end to end with new permissions (like advance on behalf), or show them only on My profile?
5. **Geofence radius range.** The design's slider covers 50–500 m. Today's input takes 25–5,000 m, and existing branches can be above 500. Keep today's range (slider plus number field)?
6. **Branch code "Auto".** Generate a code on the server when it's left blank, or show "None" in the review?
7. **Administrators' own profile.** The prototype shows owners/admins only Overview, Attendance and My pay. With Attendance hidden for admin roles, should an admin who has an employee record get the other self tabs by permission (Personal, Job, Leave, …), or only Overview and My pay?

---

## 6. Live API probe log (GET only, local API; tenant aaaaaaaa-…)

- **Companies and branches.**
  - `GET /v1/hrms/companies?includeArchived=true` (owner): one company, "UnifiedTree Demo Corp", employeeCount 19; legalName, CIN, PAN, GSTIN and industry are empty.
  - `GET /v1/hrms/branches?includeArchived=true`: 18 branches, 1 active. "Local QA Office" (QAOFF, Hyderabad, state null) has 12 people, is not HQ, has the switch off with lat/lng set, radius 375. The 17 archived branches are test fixtures ("Design QA Branch … Edited").
  - `GET /v1/settings/employee-code/preview?companyId=cccc…` (owner): `{"preview":"EMP-0143","prefix":"EMP","nextNumber":143,"padding":4}`. HR configuration: `employeeCodeNextNumber` 143, `enforceGeofencingForMobile` true, `defaultNoticePeriodDays` 60.
- **Access by role.** `/companies` and `/branches`: 200 for owner, hrm, fin, mgr and reader. Employee-code preview and `hr-configuration`: 200 for owner, hrm and fin; 403 for mgr and reader.
- **HR view endpoints (owner, for reader's record).** 200 for:
  - `/v1/hrms/employees/{id}`
  - attendance: weekly-summary, records
  - leave: balances, requests
  - expense claims, documents, letters
  - performance: kpis, employees/{id}
  - skills, salary structure
  - invitation-status, shift
  - profile addresses, emergency contacts, F&F settlements.
- **Manager (mgr, for their own report).**
  - `/v1/hrms/employees/{id}` → **403**; `/v1/employees/{id}` → 200.
  - 200: weekly-summary, records, leave balances/requests, expense claims, kpis, performance, invitation-status, shift.
  - 403: documents, salary structure, emergency contacts, by-ids.
- **Finance lead.** 200 for the record, salary structure and claims; **403** for the reader's weekly-summary (not their report).
- **Self (reader).**
  - 200: `/v1/users/me`, `/v1/employees/me`, attendance (`history`, `monthly-stats`, `weekly-summary`), payroll (`structures/me`, `payslips/me`), leave (`my/balances`, `employees/{self}/…`), `expense/employees/{self}/claims`, documents (`document/my`, `/my/missing`), `letters/my`, performance (`goals/my`, `reviews/my`), `skills/me`, `invitation-status`, own shift, own `emergency-contacts`, departments, designations.
  - 204: `/v1/attendance/today` (not checked in).
  - **403:** `/v1/hrms/employees/{self}`, `profile/addresses`, `profile/education`, `profile/identity`, `profile/emergency-contacts`, `hrms/employees/by-ids` (manager), `/v1/employees/{manager}`.
