# Company profile, Master data & HR setup — page briefs

This group is the tenant's foundation data: the legal companies and their branches/geofences, the org structure (departments, designations, grades, employment types, shifts), the employee master (directory, bulk import, the per-employee workspace), and the HR configuration screens (policies, probation reminders, work-time rules, notification templates, integration registry).
Sidebar groups (`layouts/PlatformShell.tsx`): **Company Profile** › Companies & Branches · **Master** › Workforce Directory, Organization Setup, Rules & Policies · **HR Setup** › HR Configuration, Notification Templates, Integrations. Import, the employee workspace and Work Time Settings have no sidebar entry.
Roles: every sidebar entry here is `R_HR` = **OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER**. Routes are additionally gated by permission codes (listed per page); DEPT_MANAGER / EMPLOYEE can reach `/hrms/employees/:id` only if their role carries `hrms.employee.read`, and `/hrms/policies` if it carries `hrms.policy.acknowledge.self`.

Design-system vocabulary is from `.design-sync/conventions.md`: `HrPageHeader`, `HrStatCard`, `HrStatusPill`, `HrButton`, `HrAvatar`, `HrTabs`/`HrTabPanel`, `HrSelect`, `HrDrawer`, `TableCard`, `FilterBar`, `DataTable`, `HrPagination`, `EmptyState`, `Modal`, `ConfirmDialog`, `TableSkeleton`, `CardSkeleton`.

---

## Companies & Branches  `/hrms/companies`
- **File:** `modules/hrms/organization/Companies.tsx` (reuses `CompaniesTab` + `BranchesTab` exported from `organization/OrgSetup.tsx`; lazy-loads `attendance/LocationMapPicker`)  ·  **Sidebar:** Company Profile › Companies & Branches  ·  **Roles:** R_HR (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER); RouteGuard `HRMS_BRANCH_READ`; writes need `org.company.write` (companies/branches) and `org.geofence.write` (geofence)
- **Status:** LIVE — `useCompanies → GET /v1/hrms/companies`, `useBranches → GET /v1/hrms/branches?companyId=`, geofence `PUT /v1/hrms/branches/{id}/geofence`. Audit: "Company/branch CRUD reused; geofence CRUD verified" [FUNCTIONALITY_AUDIT › Live module inventory].

### Purpose
The company admin / HR head records the legal entities of the tenant (name, legal name, PAN, GSTIN, CIN), their office branches, and the GPS attendance boundary of each branch so mobile punches can be geofenced.

### Layout
1. Plain `<h1>` "Companies & Branches" + subtitle "Manage company records, offices and attendance boundaries." (NOT an `HrPageHeader` today — should become one, crumb "Company Profile").
2. Card (`.ut-card`) containing **CompaniesTab**: right-aligned `Add Company` button; `DataTable` columns: Company (name + legalName sub-line) · Industry (`industry · country`) · Employees (`employeeCount`, tabular) · Status (`HrStatusPill` ok "Active" / gray "Inactive") · row actions (Edit pencil, Archive trash) gated `org.company.write`.
3. Company selector `<select>` ("Company") — picks which company's branches are shown below (defaults to first).
4. Two-column grid (`xl:grid-cols-[3fr_2fr]`):
   - Left card "Branches" → **BranchesTab**: `Add Branch` button; `DataTable` columns: Branch (name + `HQ` warn pill if `headquarters`) · Location (`city, state, country`) · Employees · Status pill · Archive trash (gated `org.company.write`).
   - Right card "Branch geofence": `<select aria-label="Geofence branch">` + **BranchGeofence** form: intro line "Set the permitted attendance area for {branch}. Coordinates and enforcement are saved to this branch.", checkbox "Enforce geofence", Latitude, Longitude, Radius (metres) (defaults to 100 when unset), live `LocationMapPicker` map (click to set lat/lng), `HrButton` "Save geofence".
5. `HrDrawer` "Add Company" / "Edit Company" (from CompaniesTab): fields Company Name *, Legal Name, Industry, Currency (default INR), Country (default India); boxed "Statutory details": Registration Number (CIN), Company PAN (uppercased), GSTIN (uppercased), hint "Used on PF, ESI and TDS filings. Leave blank if not yet registered."; **in edit mode only** an extra section "Employee ID auto-generation" (Prefix, Starting number, preview "Next employee will be: EMP-0142", own `Save Format` button); footer Cancel / Create | Save Changes.
6. `HrDrawer` "Add Branch": Branch Name *, Code, City, State, Country (India), checkbox "Mark as Headquarters"; footer Cancel / Create.
7. `ConfirmDialog` (danger) for Archive company / Archive branch.

### Data shown
- Companies table — `useCompanies → GET /v1/hrms/companies` (falls back to the caller's own company from `GET /v1/users/me` on 403). Fields: `name, legalName, industry, country, employeeCount, active, registrationNumber, panNumber, gstin, currency`.
- Branches table — `useBranches(companyId) → GET /v1/hrms/branches?companyId=`. Fields: `name, code, city, state, country, headquarters, employeeCount, active, latitude, longitude, geoFenceRadiusMeters, geoFenceEnforced`.
- Employee-ID format (edit drawer) — `useHrConfig(companyId) → GET /v1/settings/hr-configuration?companyId=` (`employeeCodePrefix, employeeCodeNextNumber, employeeCodePadding`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Add Company | CompaniesTab toolbar (right) | opens HrDrawer "Add Company" | `org.company.write` | LIVE |
| Edit (pencil) | company row | opens HrDrawer "Edit Company" prefilled | `org.company.write` | LIVE |
| Archive (trash) | company row | ConfirmDialog "Archive {name}?" → `useArchiveCompany → DELETE /v1/hrms/companies/{id}` → toast "Company archived" | `org.company.write` | LIVE |
| Create / Save Changes | company drawer footer | `POST /v1/hrms/companies` or `PUT /v1/hrms/companies/{id}` → toast "Company created/updated"; no-op if name blank | `org.company.write` | LIVE |
| Save Format | inside Edit Company drawer | `useUpdateHrConfig → PUT /v1/settings/hr-configuration?companyId=` with `employeeCodePrefix/NextNumber/Padding` → toast "Employee ID format saved"; disabled until the two inputs are dirty **and** valid | `org.company.write` (UI — the section only renders inside the drawer) | LIVE |
| Cancel | company drawer footer | closes drawer | all | LIVE |
| Company `<select>` | between sections | switches which company's branches + geofence are shown | all | LIVE |
| Add Branch | Branches card toolbar | opens HrDrawer "Add Branch" | `org.company.write` | LIVE |
| Create | branch drawer footer | `useCreateBranch → POST /v1/hrms/branches` → toast "Branch created" | `org.company.write` | LIVE |
| Archive (trash) | branch row | ConfirmDialog → `DELETE /v1/hrms/branches/{id}` → toast "Branch archived" | `org.company.write` | LIVE |
| Geofence branch `<select>` | geofence card | switches branch being edited (form remounts) | all | LIVE |
| Enforce geofence / Latitude / Longitude / Radius | geofence form | local state; map recenters on lat/lng change; clicking map sets lat/lng | `org.geofence.write` (fieldset disabled otherwise) | LIVE |
| Save geofence | geofence form submit | `PUT /v1/hrms/branches/{id}/geofence {latitude, longitude, radiusMeters, enforced}` → toast "Branch geofence saved"; disabled until lat/lng valid | `org.geofence.write` | LIVE |
| Retry | geofence card on error | `branches.refetch()` | all | LIVE |
| Retry | tab-level error EmptyState | `refetch()` | all | LIVE |

### States
- Companies loading: `DataTable isLoading`. Empty: "No companies yet — Add your first company to get started." Error: `EmptyState variant="error"` + Retry.
- Branches: "No branches yet — Add a branch to map your office locations."; if no company selected: first-run EmptyState "No company selected — Select a company above to manage its branches."
- Geofence card: "Loading branches..." / error message + Retry / "Create a branch to configure its attendance area." (no branches) / map shows only when lat+lng valid ("Loading map..." while lazy chunk loads).
- Edit Company drawer: "Loading employee ID format..." while config loads; inline red errors "Prefix must be 1-10 letters or digits (no spaces or dashes)." / "Starting number must be 1-8 digits."; preview shows "—" while invalid.
- No-permission: route → RouteGuard "Access Restricted"; write controls simply hidden; geofence fieldset disabled.

### Rules & permissions
- Company name required; PAN/GSTIN forced uppercase; edit **preserves** statutory fields (2026-09-08 fix noted in code).
- Employee-ID prefix: 1–10 alphanumerics; starting number 1–8 digits; padding = length of typed number; "Changes only affect employees created after saving."
- Geofence: lat ∈ [-90, 90], lng ∈ [-180, 180], radius 1–100 000 m; server validates too (WorkforceDtos).
- Branch archive is soft (assignments preserved). Company archive hides it "from lists and pickers".
- Branches list only exists for a selected company; both tabs scoped by `companyId`.

### Gaps & plan
- **Keep:** the two-table + geofence-map composition; statutory details block; employee-ID format preview; confirm dialogs on archive.
- **Add:** [BLUEPRINT §3.4 reference page inventory] Company Profile › "Companies & Branches — Branch table + geofence config" (matches today; nothing further specified). [BLUEPRINT §7 target IA] has **no** Company Profile group at all — companies/branches are expected to live under People › Organization (`/hrms/organization`), so this page is a candidate for merging. [code: `BranchesTab`] no Edit branch — only create/archive; a branch typo requires archive + recreate (no `PUT /v1/hrms/branches/{id}` hook in `useOrg.ts`). [code: `Companies.tsx`] no company-level KPI strip.
- **Change:** page uses a raw `<h1>` while every sibling uses `HrPageHeader` — align. The company selector is a bare `<select>` between two cards; make it a "Viewing for:" bar like OrgSetup. The geofence save button shows only when `canWrite` but the fieldset is silently disabled for others — show a read-only note. Companies & Branches tab duplicates OrgSetup's first two tabs; decide one home (Blueprint puts it under Company Profile).

### Screenshot
`Attach: /hrms/companies — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Companies & Branches" page for OWNER / COMPANY_ADMIN / HR_MANAGER.
Use HrPageHeader (crumb "Company Profile", title "Companies & Branches", subtitle "Manage company records, offices and attendance boundaries.", action HrButton primary "+ Add Company").
Section 1 TableCard "Companies": DataTable columns Company (name + legal name sub-line, e.g. "Acme Technologies" / "Acme Technologies Pvt Ltd"), Industry ("Technology · India"), Employees (142, tabular-nums), Status (HrStatusPill ok "Active"), row actions ghost Edit / Archive.
A "Viewing for:" company bar (Building2 icon + HrSelect) then a 3:2 grid: left TableCard "Branches" (columns Branch with warn pill "HQ", Location "Mumbai, Maharashtra, India", Employees, Status, Archive; action "+ Add Branch"); right card "Branch geofence" with HrSelect of branches, checkbox "Enforce geofence", Latitude/Longitude/Radius (metres) inputs, an embedded map, HrButton "Save geofence".
HrDrawer "Edit Company" (max-w-lg): Company Name*, Legal Name, Industry, Currency INR, Country India; boxed "Statutory details" (Registration Number "U72200MH2019PTC123456", Company PAN "ABCDE1234F", GSTIN "22ABCDE1234F1Z5", hint "Used on PF, ESI and TDS filings. Leave blank if not yet registered."); section "Employee ID auto-generation" (hint "New employees get an auto-generated ID. Changes only affect employees created after saving.") with Prefix "EMP" – Starting number "0142" and preview "Next employee will be: EMP-0142" + own "Save Format" button; footer Cancel / Save Changes.
HrDrawer "Add Branch": Branch Name*, Code "MUM", City, State, Country India, checkbox "Mark as Headquarters"; footer Cancel / Create.
States: EmptyState "No companies yet / Add your first company to get started."; "No branches yet"; "Create a branch to configure its attendance area."; error EmptyState with Retry.
Keep: confirm dialogs on Archive; statutory block. Add: an Edit branch action (currently only archive). Change: replace the bare <h1> and loose <select> with HrPageHeader and the "Viewing for" bar.
```

---

## Organisation Setup  `/hrms/organization`
- **File:** `modules/hrms/organization/OrgSetup.tsx` (1 679 lines; tabs `CompaniesTab`, `BranchesTab`, `DepartmentsTab`, `DesignationsTab`, `GradesTab`, `EmploymentTypesTab`, `ShiftsTab`)  ·  **Sidebar:** Master › Organization Setup  ·  **Roles:** R_HR; RouteGuard `HRMS_DEPARTMENT_READ | HRMS_BRANCH_READ`; per-tab write codes below
- **Status:** LIVE — every tab is wired to `api/useOrg.ts` (`/v1/hrms/companies|branches|departments|designations|grades|employment-types`) and `api/useShiftPolicies.ts` (`/v1/shifts`). Blueprint §6 row 8: "Works · Full CRUD · Class A · Keep".

### Purpose
HR admin builds and maintains the org master: companies, branches, departments (with head, colour, icon), designations, pay grades, employment types and shift timings that attendance scores against.

### Layout
1. `HrPageHeader` crumb "Master", title "Organisation Setup", subtitle "Manage companies, branches, departments, designations, grades, employment types, and shifts" (no actions).
2. `HrTabs` with icon labels: Companies · Branches · Departments · Designations · Grades · Emp. Types · Shifts.
3. "Viewing for:" company bar (`.ut-card-sm`, Building2 icon, `<select>`) — shown on every tab except Companies.
4. `HrTabPanel` → `.ut-card-lg` containing the active tab: each tab = right-aligned `+ Add …` button, `DataTable`, and an `HrDrawer` (wrapped as `SlideModal`) form with footer Cancel / Create | Save Changes.
   - **Companies**: as described on `/hrms/companies` (same component).
   - **Branches**: as described on `/hrms/companies`.
   - **Departments** `DataTable`: Department (colour dot + name) · Code · Head (inline `<select>` of employees for writers, plain text otherwise) · Employees · Status · Edit/Archive. Drawer "Add/Edit Department": Department Name *, Department Code (uppercased), Description, Department Head (search box if >8 employees + `HrSelect` "Name · EMP-0142"), Colour (8 swatches), Icon (Team/Laptop/Finance/Brain), Preview card with note "Department colours appear as left-border stripes across the Staff Directory and Attendance Logs."
   - **Designations** `DataTable`: Title · Grade · Headcount · Status · Edit/Archive. Drawer: Title *, Grade.
   - **Grades** `DataTable` (sortable by Level): Level · Name (+description) · Code · Status · Edit/Delete. Drawer: Name *, Code, Level (number), Description.
   - **Emp. Types** `DataTable`: Name (+ purple "System" pill) · Code · Payroll Eligible (pill Yes/No) · Status · Edit/Delete (hidden for system rows). Drawer "Add Employment Type" / "Edit Employment Type": Name *, Code, checkbox "Payroll eligible".
   - **Shifts**: intro text ("These are the shift timings attendance is scored against, shared with the mobile app…") + `Add Shift`; `DataTable`: Shift (name + type) · Schedule ("09:00 – 18:00") · Grace ("15 min") · Hours/Day ("8 h") · Edit/Delete. No Status column (endpoint returns only active). Drawer: Name *, Start Time, End Time, Grace (min) 0–120, Working Hours / Day 0.5–24, Shift Type * (`HrSelect` Fixed/Flexible/Rotational/Night), checkbox "Overtime applicable", Overtime Rate (×) 1–9.99 with note "payroll does not apply it automatically yet".
5. `ConfirmDialog` (danger) on every archive/delete.

### Data shown
- Companies — `GET /v1/hrms/companies`. Branches — `GET /v1/hrms/branches?companyId=`.
- Departments — `GET /v1/hrms/departments?companyId=` (`name, code, description, departmentHeadEmployeeId, colorHex, iconKey, employeeCount, active`); head picker uses `useEmployeeDirectory({companyId, pageSize:200}) → GET /v1/hrms/employees?…`.
- Designations — `GET /v1/hrms/designations?companyId=` (`title, grade, headcount, active, departmentId, reportsToDesignationId, jobResponsibilities`).
- Grades — `GET /v1/hrms/grades?companyId=` (`name, code, level, description, active`).
- Employment types — `GET /v1/hrms/employment-types?companyId=` (`name, code, payrollEligible, system, active`).
- Shifts — `useShiftPolicies → GET /v1/shifts?companyId=` (`name, shiftType, startTime "09:00:00", endTime, gracePeriodMinutes, workingHoursPerDay, overtimeApplicable, overtimeMultiplier`).
- Employee-ID format inside Edit Company — `GET/PUT /v1/settings/hr-configuration?companyId=`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tab click ×7 | HrTabs | switches tab (local state, not in URL) | route roles | LIVE |
| Viewing for `<select>` | bar under tabs | sets active company for all non-company tabs | all | LIVE |
| Add Company / Edit / Archive / Create / Save Changes / Save Format | Companies tab | see `/hrms/companies` (POST/PUT/DELETE `/v1/hrms/companies`) | `org.company.write` | LIVE |
| Add Branch / Create / Archive | Branches tab | `POST /v1/hrms/branches`, `DELETE /v1/hrms/branches/{id}` | `org.company.write` | LIVE |
| Add Department | Departments toolbar | opens drawer | `hrms.department.write` | LIVE |
| Create (department) | drawer footer | client duplicate-name check → `POST /v1/hrms/departments` (with colorHex/iconKey) → toast "Department created"; network-drop recovery refetches and PATCHes appearance | `hrms.department.write` | LIVE |
| Save Changes (department) | drawer footer | up to 4 PATCHes only for changed fields: `/departments/{id}/name`, `/head?employeeId=`, `/details?code=&description=`, `/appearance?colorHex=&iconKey=` → toast "Department updated" | `hrms.department.write` | LIVE |
| Head inline `<select>` | department row | `PATCH /v1/hrms/departments/{id}/head` → toast "Department head updated" | `hrms.department.write` | LIVE |
| Edit / Archive (department) | row | drawer / ConfirmDialog → `DELETE /v1/hrms/departments/{id}` | `hrms.department.write` | LIVE |
| Head search box | department drawer (only if >8 employees) | filters `HrSelect` options by name/code/email; "No staff match “x”." | writers | LIVE |
| Colour swatch ×8 / Icon ×4 | department drawer | local form state; preview updates | writers | LIVE |
| Add Designation / Edit / Archive / Create / Save Changes | Designations tab | `POST /v1/hrms/designations`, `PUT /v1/hrms/designations/{id}` (echoes departmentId/reportsTo/jobResponsibilities), `DELETE` | `hrms.designation.write` | LIVE |
| Add Grade / Edit / Delete / Create / Save Changes | Grades tab | `POST/PUT/DELETE /v1/hrms/grades` → toasts "Grade created/updated/deleted" | `hrms.grade.write` | LIVE |
| Sort by Level | Grades header | client sort asc/desc | all | LIVE |
| Add Type / Edit / Delete / Create / Save Changes | Emp. Types tab | `POST/PUT/DELETE /v1/hrms/employment-types`; system rows have no actions | `hrms.employment_type.write` | LIVE |
| Add Shift / Edit / Delete / Create / Save Changes | Shifts tab | `POST /v1/shifts?companyId=`, `PUT /v1/shifts/{id}`, `DELETE /v1/shifts/{id}` (409 SHIFT_IN_USE surfaced) → toasts "Shift created/updated/deleted" | `attendance.regularization.approve` | LIVE |
| Overtime applicable checkbox | shift drawer | reveals Overtime Rate field; multiplier only sent when on | writers | LIVE |
| Cancel | every drawer footer | closes | all | LIVE |
| Retry | tab error state | `refetch()` | all | LIVE |

### States
- Loading: `DataTable isLoading` skeleton per tab.
- Empty per tab: "No companies yet / Add your first company to get started." · "No branches yet / Add a branch to map your office locations." · "No departments yet / Structure your company by adding departments." · "No designations yet / Define roles and job titles for your employees." · "No grades configured / Create pay grades to structure your compensation bands." · "No employment types / System types are seeded automatically. Add custom types here." · "No shifts configured / Define work shifts and schedules for your teams."
- No company selected (tabs 2–7): first-run EmptyState "No company selected — Select a company above to manage its …".
- Error: `EmptyState variant="error"` + Retry. Validation toasts on shifts (see rules).
- No-permission: add/edit/delete controls hidden via `<Can>`; head select falls back to text.

### Rules & permissions
- Department: case-insensitive duplicate-name guard client + server (`DUPLICATE_DEPARTMENT`); code uppercased; no full-update endpoint so edit fans out to per-field PATCHes.
- Designation update is a full replace — hidden fields are echoed to avoid nulling them.
- Grades/Employment types are hard **deletes** ("cannot be undone"); departments/designations/branches/companies are **archives** (soft).
- Shift: name required; start ≠ end; FIXED must end after start (only NIGHT wraps midnight); grace 0–120; hours 0.5–24; OT multiplier 1.0–9.99 only when OT on. Edits write `attendance.shift_policies` (the table late-marking reads), gated on `attendance.regularization.approve` — not on `hrms.shift.write`.
- Everything but Companies is scoped to the "Viewing for" company.

### Gaps & plan
- **Keep:** the 7-tab master with per-tab drawers; colour/icon preview; statutory details; shift validation messages; confirm dialogs.
- **Add:** [BLUEPRINT §6 row 8] "Keep; surface under People" — IA move only ([BLUEPRINT §7 target IA] lists it as People › Organization `/hrms/organization`). [BLUEPRINT §6 rows 4–5] Contractor Master and Classification Rules "No UI" though `/v1/hrms/contractors` and `/v1/hrms/classifications` exist — target "Tab on Workforce" (could equally live here as master tabs). [code: `BranchesTab`] no edit-branch. [code: `ShiftsTab` note] "Per-employee weekly offs are still set on the employee record" — no day-of-week control on shifts by design. [code: OT rate hint] "payroll does not apply it automatically yet" → [HANDOFF §10 E] overtime-to-payroll posting pending a compensation rule.
- **Change:** tab state is not in the URL (`?tab=`) so a deep link to Shifts is impossible — EmployeeDetail already does this; copy it. Shifts are editable in **three** places (this tab, Rules & Policies › Shift Rules, Attendance › Shifts & Overtime) with two different form layouts — pick one canonical home and link the others. Buttons here are raw styled `<button>`s (`BTN_PRIMARY`, `BTN_ADD`) rather than `HrButton`. Companies and Branches tabs duplicate `/hrms/companies`.

### Screenshot
`Attach: /hrms/organization — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Organisation Setup" page for OWNER / COMPANY_ADMIN / HR_MANAGER.
HrPageHeader: crumb "Master", title "Organisation Setup", subtitle "Manage companies, branches, departments, designations, grades, employment types, and shifts". Below it HrTabs with lucide icons: Companies · Branches · Departments · Designations · Grades · Emp. Types · Shifts (tab key mirrored to ?tab=).
Under the tabs a "Viewing for:" bar (Building2 icon + HrSelect "Acme Technologies") on every tab except Companies.
Each tab is one TableCard with a primary HrButton "+ Add Department" (etc.) top-right and a DataTable:
 • Departments: Department (colour dot + "Engineering"), Code "ENG", Head (HrSelect inline "Aarav Menon · EMP-0142"), Employees 38, Status pill, ghost Edit / Archive.
 • Designations: Title "Senior Engineer", Grade "L4", Headcount 12, Status, Edit / Archive.
 • Grades: Level (sortable) 4, Name "Senior" + description, Code "L4", Status, Edit / Delete.
 • Emp. Types: Name "Full Time" + purple "System" pill, Code FULL_TIME, Payroll Eligible pill Yes, Status; system rows have no actions.
 • Shifts: Shift "General Shift / fixed", Schedule "09:00 – 18:00", Grace "15 min", Hours/Day "8 h", Edit / Delete; intro note that the grace period is the on-time window.
HrDrawer "Edit Department": Department Name*, Department Code, Description, Department Head (search input + HrSelect), Colour (8 swatches), Icon (Team/Laptop/Finance/Brain), Preview card, footer Cancel / Save Changes.
HrDrawer "Add Shift": Name*, Start Time 09:00, End Time 18:00, Grace (min) 15, Working Hours / Day 8, Shift Type* (Fixed/Flexible/Rotational/Night), checkbox "Overtime applicable" revealing "Overtime Rate (×) 1.5" with hint "Stored as the configured rate — payroll does not apply it automatically yet."
States: per-tab EmptyState copy ("No departments yet / Structure your company by adding departments."), first-run "No company selected", error + Retry, ConfirmDialog danger on Archive/Delete.
Keep the 7-tab structure. Add: Edit action on branches. Change: use HrButton everywhere instead of custom buttons; put the tab in the URL.
```

---

## Workforce Directory  `/hrms/employees`
- **File:** `modules/hrms/Employees.tsx` (+ `employees/EmployeeForm.tsx` drawer, `employees/InlineCreateModals.tsx`)  ·  **Sidebar:** Master › Workforce Directory  ·  **Roles:** R_HR; RequirePermission + RouteGuard `hrms.employee.read`; Add needs `hrms.employee.write`, Import needs `hrms.employee.import`
- **Status:** LIVE — `useEmployeeDirectory → GET /v1/hrms/employees?companyId&departmentId&branchId&status&search&page&pageSize=25`; KPI strip `useEmployeeCounts → GET /v1/hrms/employees/counts?companyId=`. Blueprint §6 row 3: "Filters ok · Class B · + export, bulk, rows-per-page, type filter".

### Purpose
HR finds a person, sees the headcount breakdown by status, filters by department/branch/status, and opens the employee workspace or adds/imports employees. It is "the screen HR lives in" (Blueprint §19 Reports).

### Layout
1. `HrPageHeader` crumb "Master", title "Workforce Directory", subtitle "{Company name} · {total} employees"; actions: ghost `Org Setup` (Building2), ghost `Import` (Upload, `<Can HRMS_EMPLOYEE_IMPORT>`), primary `+ Add Employee` (hidden if no company or no write).
2. KPI strip (2×2 → 4 cols) of `HrStatCard`: **Total** (blue, `counts.total`) · **Active** (green, `counts.active`) · **On Notice** (orange, `counts.notice`) · **Exited** (red, `counts.exited + counts.terminated`). All `loading` while directory loads. Not clickable.
3. `TableCard` with `search` ("Search name, code, email…", debounced 350 ms) and toolbar `actions`: company `<select>` (only if >1 company), `All Departments`, `All Branches`, status `<select>` (All Statuses / Active / Probation / On Notice / Suspended / Exited / Terminated), text button `Clear filters` (only when a filter is set). Footer: "Showing 1–25 of 142" + prev/next chevrons + "1 / 6".
4. `hr-table` columns: Employee (`HrAvatar` name + email) · Code (`hr-mono`, e.g. EMP-0142) · Department · Branch · Type (`FULL TIME`) · Status (`HrStatusPill`: ACTIVE ok "Active", PROBATION warn "Probation", NOTICE_PERIOD late "Notice", SUSPENDED warn, EXITED/TERMINATED red) · Joined (`d MMM yyyy`). Whole row is clickable → `/hrms/employees/{id}`.
5. `EmployeeForm` drawer (3-step wizard **Basic → Financial → Review**; edit mode is 2 steps): Basic = Company (+ "+ Add"), First Name *, Last Name, Work Email *, Phone *, Designation * (+ "+ Add"/"+ Save to list"), Department * (+ "+ Add"), Employee Code * (auto-filled from `GET /v1/settings/employee-code/preview`), Date of Joining *, Date of Birth, Gender, Report To, Punch Location (Zone) (+ "+ Add"), Shift Timing, Weekly Off Days. Financial = Salary Frequency * (Monthly/Weekly/Daily), Monthly Salary (₹), Employment Type (the company's active lookup types when their codes are backend enums, else Full Time / Part Time / Contract / Intern), PAN Number, Aadhaar Number, UAN Number, ESI Number, Bank Account Number, IFSC Code, Bank Name, Bank Branch. Review = `SummaryRow` list of all fields (Company, Name, Email, Phone, Designation, Department, Employee Code, Date of Joining, Date of Birth, Gender, Geofence Zone, Shift, Weekly Offs, Salary Frequency, Monthly Salary, Employment Type, PAN, Aadhaar, UAN, ESI, Bank Account, IFSC, Bank Name, Bank Branch) + checkbox "Send invitation email to **{email}**" (default on, only with `hrms.employee.invite`) with note "An invitation email will be queued to {email} with a secure link (expires in 24h)…" + footnote "Required: First Name, Email, Phone, Designation, Employee Code, Department, Date of Joining and Salary Frequency." + full-width primary `Create Employee`. Drawer heading "Add Employee" / "Edit Employee"; footer Back · Cancel · Next (or `Save Changes` on Financial in edit mode). Inline modals (titles "Add Company" / "Add Department" / "Add Designation" / "Add Geofence Zone"): `InlineCreateCompanyModal`, `InlineCreateDepartmentModal`, `InlineCreateDesignationModal`, `InlineCreateZoneModal`.

### Data shown
- Directory rows — `GET /v1/hrms/employees` page (`firstName, lastName, email, employeeCode, departmentId, branchId, employmentType, employmentStatus, dateOfJoining`); dept/branch names resolved client-side from `useDepartments`/`useBranches`.
- Counts — `GET /v1/hrms/employees/counts?companyId=` (`total, active, notice, exited, terminated`).
- Filters — `useCompanies`, `useDepartments(companyId)`, `useBranches(companyId)`.
- Deep links: `?status=PROBATION` preselects the status filter (dashboard drill-down); `?add=1` opens the Add drawer then strips the param.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Org Setup | header | `navigate('/hrms/organization')` | route roles | LIVE |
| Import | header | `navigate('/hrms/employees/import')` | `hrms.employee.import` | LIVE |
| + Add Employee | header | opens `EmployeeForm` drawer; on success toast "Employee added" | `hrms.employee.write` (and ≥1 company) | LIVE |
| Create a company | EmptyState (no companies) | `navigate('/hrms/organization')` | `org.company.write` | LIVE |
| Search | TableCard toolbar | server search, resets page | all | LIVE |
| Company / Department / Branch / Status selects | toolbar | server filters; switching company clears dept/branch | all | LIVE |
| Clear filters | toolbar | resets all filters + page | all | LIVE |
| Row click | table row | `navigate('/hrms/employees/{id}')` | all | LIVE |
| Prev / Next page | TableCard footer | page ±1 (25 rows fixed) | all | LIVE |
| Retry | error EmptyState | `refetch()` | all | LIVE |
| Next / Back / step pills | EmployeeForm | `Next` validates the current step and jumps to the first error; pills only go **backwards** (forward pills are disabled with tooltip "Use Next — the current step has to be valid first") | writers | LIVE |
| Create Employee (Review) / Save Changes (Financial in edit) | EmployeeForm | `POST /v1/hrms/employees` or `PUT /v1/hrms/employees/{id}`; queues invite when the checkbox is on ("Employee created. Invitation email queued for {email}." or warning "Employee created (could not queue invitation — resend from Users & Access)"); duplicate errors "That employee code is already in use." / "That email is already in use for this company."; edit success "Employee updated" | `hrms.employee.write` | LIVE |
| Send invitation email to {email} | EmployeeForm Review step | checkbox (default on) controlling whether `POST /v1/employees/{id}/invite` runs after create | `hrms.employee.invite` | LIVE |
| Add seats (opens new tab) / I've added seats — save this employee / Back to form | EmployeeForm seat-limit panel (shown on HTTP 402) | `window.open('/plan')` · clears the block and re-runs submit · returns to the form; non-billing users see "Only a workspace admin can change the plan." | billing users for Add seats; all otherwise | LIVE |
| + Add / + Save to list (Company / Department / Designation / Zone) | EmployeeForm Basic step | opens inline create modal (each gated on its own write perm); Designation typed free-text can be saved as a reusable designation | per-entity write | LIVE |

### States
- Loading: KPI cards skeleton + `TableSkeleton`; refetch dims table (`opacity-70`).
- No companies: `EmptyState` "No companies yet — Create a company before you can add employees." (or "Ask an admin to set up a company first.") with `Create a company`.
- Empty rows: in-table "No employees found" + "Try adjusting your search or filters" when filters set.
- Error: `EmptyState variant="error"` "Failed to load employees" + message + Retry.
- EmployeeForm: seat-limit panel "You've run out of seats" (replaces the form on 402; "A seat is one active employee…"); warning toast "Company data is still loading — try again in a moment." if lookups have not resolved on submit.
- No-permission: RouteGuard "Access Restricted".

### Rules & permissions
- Page size hard-coded 25; company-scoped; KPI counts are server totals independent of table filters.
- Status keys must match backend `WorkforceEmployee.EmploymentStatus`.
- Add button hidden until a company exists (P0-2 fix).
- EmployeeForm: Basic requires company, first name, email, phone, designation, department, employee code, DOJ; Financial requires salary frequency only; employee code auto-generated from the company's prefix/next-number unless typed over.

### Gaps & plan
- **Keep:** server search + 3 filters + status deep-link; KPI strip; row → workspace; 3-step Add wizard with inline "+ Add" creates.
- **Add:** [BLUEPRINT §6 row 3 / PLAN §7.1] Employment-type filter (param exists) · Rows per page 10/25/50/100 · **Export CSV** (`/v1/hrms/employees/export.csv`; [BLUEPRINT §19 Reports] "no employee directory export (P0 — the screen HR lives in)", repeated in [§27 P0] "employee directory CSV export") · Bulk selection checkbox column + bulk actions (Invite · Change dept · Change manager · Assign shift · Deactivate — needs bulk endpoint) · Contractor Master tab (`/v1/hrms/contractors`) · Classification Rules tab (`/v1/hrms/classifications`) — [BLUEPRINT §7 target IA] "Workforce Directory ├ Employees · Contractors* · Classifications*" and [§6 rows 4–5] "Tab on Workforce".
- **Change:** KPI cards are not clickable — make them set the status filter ([BLUEPRINT §6 row 1 / §8.3 drill-down map] "Every metric drills down"). Pagination is hand-rolled chevrons — use `HrPagination`/`hrPaginationFooter`. Filters are raw `<select>`s — use `FilterBar`/`FilterDef[]`. "On Notice" card label vs "Notice" pill vs "On Notice" filter option — unify wording.

### Screenshot
`Attach: /hrms/employees — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Workforce Directory" list page for OWNER / COMPANY_ADMIN / HR_MANAGER.
HrPageHeader: crumb "Master", title "Workforce Directory", subtitle "Acme Technologies · 142 employees"; actions ghost "Org Setup", ghost "Import", ghost "Export CSV" (new), primary "+ Add Employee".
KPI strip of 4 clickable HrStatCard: Total 142 (blue, Users), Active 128 (green, UserCheck), On Notice 6 (orange, Clock), Exited 8 (red, UserX) — clicking sets the Status filter.
TableCard: search "Search name, code, email…", FilterBar with Company, Department, Branch, Status (All / Active / Probation / On Notice / Suspended / Exited / Terminated), Employment type (new), "Clear filters"; footer hrPaginationFooter "Showing 1–25 of 142" with rows-per-page 10/25/50/100.
DataTable columns: checkbox (bulk select, new), Employee (HrAvatar "Aarav Menon" / aarav.menon@acme.in), Code "EMP-0142" mono, Department "Engineering", Branch "Mumbai HQ", Type "Full time", Status HrStatusPill (ok Active · warn Probation · late Notice · red Exited), Joined "18 Sep 2026". Whole row opens the employee workspace. A bulk bar appears on selection: Invite · Change department · Change manager · Assign shift · Deactivate.
HrDrawer "Add Employee" as a 3-step wizard (step pills Basic · Financial · Review): Basic = Company, First/Last Name, Work Email, Phone, Designation, Department (each with "+ Add" pill), Employee Code (prefilled EMP-0143), Date of Joining, Date of Birth, Gender, Report To, Punch Location (Zone), Shift Timing, Weekly Off Days; Financial = Salary Frequency, Monthly Salary (₹) "₹1,20,000", Employment Type, PAN Number, Aadhaar Number, UAN Number, ESI Number, Bank Account Number, IFSC Code, Bank Name, Bank Branch; Review = summary rows + checkbox "Send invitation email to aarav.menon@acme.in" + full-width primary "Create Employee"; footer Back / Cancel / Next (edit mode: "Save Changes"). Also design the seat-limit panel "You've run out of seats" with "Add seats (opens new tab)" / "I've added seats — save this employee" / "Back to form".
States: TableSkeleton; EmptyState "No companies yet — Create a company before you can add employees." with "Create a company"; in-table "No employees found / Try adjusting your search or filters"; error "Failed to load employees" + Retry.
Keep search/filters/deep-link ?status=. Add export, bulk, rows-per-page, type filter (Blueprint §7.1). Change: drill-down KPIs, HrPagination, FilterBar.
```

---

## Import employees  `/hrms/employees/import`
- **File:** `modules/hrms/employees/EmployeeImport.tsx`  ·  **Sidebar:** not in sidebar — reached from Workforce Directory › `Import` and the ⌘K action registry (`shared/search/actionRegistry.ts`)  ·  **Roles:** RouteGuard `hrms.employee.import`
- **Status:** LIVE — `useDownloadTemplate → GET /v1/bulk-import/employees/template` (xlsx), `useValidateBulkImport → POST /v1/bulk-import/employees/validate` (multipart, progress), `useCommitBulkImport → POST /v1/bulk-import/employees/commit`.

### Purpose
HR bulk-creates employees from a CSV/XLSX: download the template, upload, get row-level validation errors, then commit once every row is valid.

### Layout
1. Breadcrumb links HRMS › Employees › Import, then `HrPageHeader` crumb "Employees", title "Import employees", subtitle "Upload a CSV or XLSX file to add multiple employees at once.", action ghost `← Back to employees`.
2. `Stepper` (3 numbered circles + connectors): 1 Download template · 2 Upload & validate · 3 Confirm import.
3. **Step 1 card**: "Download the template" copy; "Required columns" code chips (`first_name, last_name, email, employment_type, date_of_joining`); "Optional columns" chips (`phone, department, designation, job_title, gender, date_of_birth`); bullet rules (employment_type values FULL_TIME/PART_TIME/CONTRACT/INTERN/CONSULTANT; date yyyy-MM-dd; max 1 000 rows; max 10 MB; .csv/.xlsx); `HrButton` `Download template` + text link "I have a file ready → Go to upload".
4. **Step 2**: "Import into company" `<select>` card (only if >1 company); `DropZone` card (drag/drop or click, shows file name + KB, "Accepts .csv or .xlsx · Max 10 MB"); `HrButton` `Validate file`; progress line "Validating {file}… 42%"; red alert "Validation request failed"; on result: KPI strip of 3 `HrStatCard` — Total rows (blue) · Valid (green) · Errors (red/green); `TableCard` with search "Filter errors…" and columns Row # · Error (first 100, footer "… and N more errors not shown."); action row: ghost `Upload a different file`, primary `Continue with N valid rows →`, or helper text "Fix N errors above and re-upload — the backend requires all rows to be valid before any are committed."
5. **Step 3 card** "Confirm import": "You are about to create **N** new employees in **{company}**. This cannot be undone…"; `<details>` "Preview the N employees being imported" (only row count — see gaps); ghost `← Back`, primary `Confirm — create N employees`. While committing: spinner card "Creating employees… / Do not close this page." with progress bar.
6. **Done**: success card "Imported successfully — N employees were created in {company}" with `View employees →` + "Import more"; or amber card "Import blocked by validation errors" with error list (first 20) + `Back to validate`; or `EmptyState` "Import failed … check the employees list to confirm what was created." + `Try again`.

### Data shown
- Companies — `useCompanies`. Tenant name from `useAuthStore`.
- Validation result `BulkImportResult { totalRows, errorCount, errors[], committed, successCount }` from the validate/commit endpoints; `parseErrors()` splits row number + message.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Back to employees | header | `navigate('/hrms/employees')` | all | LIVE |
| HRMS / Employees crumbs | breadcrumb | `Link` to `/hrms`, `/hrms/employees` | all | LIVE |
| Download template | step 1 | `GET /v1/bulk-import/employees/template` → saves `employees-template-{tenant}.xlsx` | all | LIVE |
| I have a file ready → Go to upload | step 1 | step = 2 | all | LIVE |
| Import into company `<select>` | step 2 | sets companyId, resets validation | all | LIVE |
| Drop zone / file input | step 2 | client checks size ≤10 MB and .csv/.xlsx (toast on failure) | all | LIVE |
| Validate file | step 2 | `POST …/validate` (multipart, companyId); toasts for empty file (warning) or >1 000 rows (error) | all | LIVE |
| Filter errors… | error TableCard search | client filter by message / row # | all | LIVE |
| Upload a different file | step 2 | `reset()` → step 1 | all | LIVE |
| Continue with N valid rows | step 2 (only when 0 errors) | step = 3 | all | LIVE |
| Back | step 3 | step = 2 | all | LIVE |
| Confirm — create N employees | step 3 | `POST …/commit` → done; invalidates `['hrms','employees']` | all | LIVE |
| View employees | done | `navigate('/hrms/employees')` | all | LIVE |
| Import more | done | `reset()` | all | LIVE |
| Back to validate | done (blocked) | step = 2 | all | LIVE |
| Try again | done (network error) | re-runs commit | all | LIVE |

### States
- Step-specific as above; `beforeunload` guard on step 3 with validated data; skeletons on step 2 while companies load.
- Empty file → toast "File appears to be empty. Check the template structure."; >1 000 rows → error toast; a validated file with 0 errors and 0 rows shows "File is empty — add some rows and re-upload." instead of the Continue button.
- Error table with an active filter and no matches: in-table "No errors match the filter".
- Template download failure → error "Could not download the template ({status}). Please try again."
- No-permission: RouteGuard.

### Rules & permissions
- 10 MB / 1 000 rows / .csv .xlsx; all-or-nothing commit ("backend requires all rows to be valid before any are committed"); commit may still be blocked if an email was taken between validate and commit.
- Company chosen at step 2 scopes the import.

### Gaps & plan
- **Keep:** 3-step wizard, error table with filter, all-or-nothing messaging, done/blocked/failed outcomes.
- **Add:** [code: NOTE[backend] in `EmployeeImport.tsx`] "validate endpoint does not return parsed row data … Full row preview requires the backend to include parsed employee objects in BulkImportResult" — the step-3 preview is a placeholder. [PLAN §7.1 / BLUEPRINT §6 row 3] bulk operations (selection + bulk actions) belong on the directory, not in this wizard.
- **Change:** duplicated breadcrumb (manual `<nav>` + `HrPageHeader crumb`) — keep one. Stepper and DropZone are bespoke; express them with DS tokens.

### Screenshot
`Attach: /hrms/employees/import — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Import employees" wizard for HR_MANAGER / COMPANY_ADMIN (permission hrms.employee.import).
HrPageHeader: crumb "Employees", title "Import employees", subtitle "Upload a CSV or XLSX file to add multiple employees at once.", action ghost "← Back to employees". Below, a 3-step stepper: 1 Download template · 2 Upload & validate · 3 Confirm import.
Step 1 card: "Required columns" chips first_name, last_name, email, employment_type, date_of_joining; "Optional columns" chips phone, department, designation, job_title, gender, date_of_birth; rules list (FULL_TIME/PART_TIME/CONTRACT/INTERN/CONSULTANT; yyyy-MM-dd; max 1,000 rows; 10 MB); HrButton "Download template" + link "I have a file ready → Go to upload".
Step 2: "Import into company" HrSelect; dashed drop zone "Drag & drop your file here, or click to browse / Accepts .csv or .xlsx · Max 10 MB"; HrButton "Validate file"; progress "Validating employees.xlsx… 42%". Result: 3 HrStatCard Total rows 240 · Valid 236 · Errors 4 (red); TableCard with search "Filter errors…" and columns Row # (mono) / Error ("Row 17: email already exists"); actions ghost "Upload a different file", primary "Continue with 236 valid rows →".
Step 3 card "Confirm import": "You are about to create 236 new employees in Acme Technologies. This cannot be undone." collapsible preview, ghost "← Back", primary "Confirm — create 236 employees"; committing state with spinner + progress bar "Do not close this page."
Done: success card "Imported successfully — 236 employees were created" with "View employees →" and "Import more"; amber "Import blocked by validation errors" with error list and "Back to validate"; EmptyState "Import failed" + "Try again".
Keep all-or-nothing messaging. Add a real row preview table once the backend returns parsed rows. Change: single breadcrumb, DS-token stepper.
```

---

## Employee workspace  `/hrms/employees/:id`
- **File:** `modules/hrms/employees/EmployeeDetail.tsx` (orchestrator) + `employees/workspace/{EmployeeOverview, EmployeePersonal, EmployeeJob, EmployeeAttendance, EmployeePayroll, EmployeeDocuments, EmployeeLetters, EmployeePerformance, EmployeeExit, shared}.tsx`, `attendance/EmployeeShiftAction.tsx`, `onboarding/OnboardingRecord.tsx`, `employees/EmployeeForm.tsx`  ·  **Sidebar:** not in sidebar — reached from Workforce Directory row, ⌘K people search, dashboard links, Job tab "Reports to"  ·  **Roles:** RouteGuard `hrms.employee.read`; each tab re-gates on its own domain permission (below)
- **Status:** LIVE — `useWorkforceEmployee → GET /v1/hrms/employees/{id}` plus per-tab endpoints; lifecycle mutations `POST /v1/hrms/employees/{id}/confirm|notice|exit|cancel-notice`, `POST /v1/probation/employees/{id}/extend`. Blueprint §10 target realised except Leave/Expenses tabs (see gaps).

### Purpose
The single place to read one employee's state and reach the work that concerns them: identity, employment, attendance this week, salary structure, bank accounts, filed documents, generated letters, goals/skills, and the join → probation → notice → exit lifecycle with its actions.

### Layout
1. Text button `← Back` (history back, else `/hrms/employees`).
2. **Profile card** (`.ut-card-lg`): 64 px emerald initials tile · name (h1) · employee code · right: status `HrStatusPill` (Active/Probation/Notice Period/Suspended/Exited/Terminated) · ghost `Change shift` (`EmployeeShiftAction`, gated `attendance.regularization.approve`) · icon button `Edit employee` (`<Can HRMS_EMPLOYEE_WRITE>`). Meta line: company · department · "Joined 18 Sep 2026". Divider then **lifecycle chips** (`<Can HRMS_EMPLOYEE_WRITE>`): PROBATION → `Confirm Probation`; ACTIVE → `Start Notice`; NOTICE_PERIOD → `Cancel Notice` + `Mark Exited`.
3. **Probation banner** (amber) when PROBATION: "Probation ends in N days" / "Probation period has ended" / "Probation end date not set" + date; buttons `Confirm as permanent`, `Extend`, `Begin exit`.
4. `HrTabs` (tab in URL `?tab=`): Overview · Personal (if `hrms.employee.profile.read` or `identity.read`) · Job · Attendance (`attendance.team.read`) · Payroll (`payroll.structure.read` or `hrms.employee.bank.read`) · Documents (`hrms.document.read`) · Letters (`hrms.letters.read`) · Performance (`hrms.performance.read` or `hrms.learning.skill.read`) · Exit.
5. `HrTabPanel` per tab (sub-sections below).
6. Lifecycle `ActionModal`s (from `workspace/shared.tsx`): "Confirm Probation" (Confirmation Date) · "Extend Probation" (New Probation End Date *) · "Start Notice Period" (Notice Start Date, Last Working Day *, Reason ≤100) · "Mark Employee as Exited" (Last Working Day *, Exit Reason) · "Cancel Notice Period" (confirmation copy). `EmployeeForm` drawer in edit mode (Basic → Financial).

#### Overview tab (`EmployeeOverview.tsx`)
- 2:1 grid: **Employment card** (designation, department · branch, status pill; `InfoRow`s Company, Employment type, Joined, Reports to (name via `GET /v1/hrms/employees/by-ids?ids=`), Branch, Probation ends / Confirmed, Last working day) + **AccountCard** ("Account active" ✓ or "No login account yet…" with `Send invitation` / `Resend` → `POST /v1/employees/{id}/invite[/resend]`, gated `hrms.employee.invite`; `FaceResetRow` "Reset face enrollment" → `POST /v1/attendance/face/admin/{id}/reset`, gated `attendance.face.admin.reset`, inline confirm "Yes, reset").
- **Needs attention** list (each row a button): probation ending ≤30 d / ended → "Review lifecycle" (exit tab); serving notice → "Open exit"; "No salary structure — this employee cannot be included in a payroll run." → "Set up payroll"; "No shift assigned — lateness and overtime can't be measured." → "Open attendance"; "N unmarked/absent days this week." → "See attendance".
- **At a glance** 4 `Tile`s (clickable → tab): This week (hours, "3 present · 1 late") · Salary structure ("₹12,00,000", "Effective 1 Apr 2026") · Documents (count) · Goals (count). Each gated on its permission; if none: explanatory sentence.
- Card "Not on this page yet": explains Leave balances, expense claims and salary advances can't be read for another employee; links to Leave and Expenses.
- `OnboardingRecord` card (gated `hrms.employee.write`) → `GET /v1/hrms/employees/{id}/onboarding-record`: details `<dl>`, "Recorded asset issues" table (Type/Model/Serial/Issued on), "Policies selected for the hire", "Joining checklist" (Confirmed/Pending), "Document verification checklist".

#### Personal tab (`EmployeePersonal.tsx`)
`SubSection`s each with own loading/empty/error: **Contact & addresses** (`GET/POST/DELETE /v1/employees/{id}/profile/addresses`; drawer "Add Address": Line 1, Line 2, City, State, Country India, Pincode; empty "No addresses — Add a permanent, current, or office address.") · **Identity documents** (`GET/PUT …/profile/identity`; masked `PiiField`s PAN / Aadhaar / Passport with show toggle; inline form PAN, Aadhaar (12 digits), UAN, ESIC Number, Passport Number, Passport Expiry → `Save Identity`, gated `hrms.employee.identity.write`) · **Education** (drawer: Degree *, Field of Study, Institution *, Start/End Year, Grade / Percentage) · **Work experience** (Company Name *, Designation / Role, Start Date *, End Date / current, Location, Description) · **Dependents** (Name *, Relationship *, Date of Birth, Nominee %) · **Emergency contacts** (Name *, Relationship, Phone, Email). Adds/deletes gated `hrms.employee.profile.write`; reads `hrms.employee.profile.read` (identity: `identity.read`). Forbidden: "You don't have access to personal details".

#### Job tab (`EmployeeJob.tsx`)
**Employment details** card (`InfoRow` Department, Designation, Branch, Employment Type, CTC (Annual) "₹12,00,000" only with `payroll.structure.read`) + dates card (Joining Date, Confirmation Date, Probation End, Last Working Day) + `Edit Work Details` (`<Can HRMS_EMPLOYEE_WRITE>`) → `HrDrawer` "Edit Work Details": Department, Designation, Branch, Employment Type (only backend enum codes), Reporting Manager ID (raw UUID input), CTC Annual (₹) → `PUT /v1/hrms/employees/{id}`. **Reporting line** card → manager avatar link to their workspace / "No reporting manager set. Approvals … fall back to the department head." **Assigned shift** (`GET /v1/shifts/employee/{id}`, only fetched with `attendance.team.read`; empty "No shift assigned — Assign a shift from Attendance → Shifts & OT.").

#### Attendance tab (`EmployeeAttendance.tsx`)
**This week** (`GET /v1/attendance/employee/{id}/weekly-summary`): 4 `Metric` cards Hours / Present days / Overtime / Avg arrival + 7-day `WeekStrip` (pill On time · Late · Week off · Holiday · On leave · Absent · Upcoming, hours, "09:12 → 18:40", "12m late"). **Shift** card (name, timing, grace, effective from). **Recent records** (`GET /v1/attendance/employee/{id}/records?page&size=31`): `TableCard` columns Date · Status · In · Out · Hours · Late · OT · Source (Regularised / Manual / method) with `hrPaginationFooter`. 403 → "You don't have access to this employee's attendance — visible to HR, admins, and the employee's own manager."

#### Payroll tab (`EmployeePayroll.tsx`)
**Salary structure** (`GET /v1/payroll/structures/employee/{id}` + history + `GET …/salary-components`): 4 money cards Annual CTC (+ "/ month") · Gross / mo · Deductions / mo · Net pay / mo; "Tax regime: NEW · PF: …"; note when `derivedFromCtc`; `DataTable` Component · Type · Monthly · Annual; **History** table Effective · CTC · Status (Current/Past); `Revise structure` / `Add structure` (`<Can PAYROLL_STRUCTURE_MANAGE>`) → `HrDrawer` "Salary structure": Annual CTC (₹) *, Effective from, Tax regime (New/Old), checkbox PF applicable, per-component monthly amounts → `Save structure` (toast "Enter a valid annual CTC" if ≤0). Empty: "No salary structure — Define this employee's salary structure to enable payroll." **Bank accounts** (`GET/POST/DELETE /v1/employees/{id}/profile/bank-accounts`): cards (holder, bank · branch, "IFSC: SBIN0001234 · ****4321", pills Primary / Verified, delete); `Add Account` drawer: Account Number *, IFSC Code *, Account Holder Name *, Bank Name, Branch, "Set as primary account". Info card "Payslip history isn't shown here yet".

#### Documents tab (`EmployeeDocuments.tsx`)
`GET /v1/document/employee/{id}?page&size=10`; `SubSection` "Filed documents" (hint "N documents on record") with ghost `Open Document Vault` (writers); `TableCard` Title (+notes) · Category pill (CONTRACT purple, ID_PROOF blue, CERTIFICATE teal, PAYSLIP green, POLICY gray, TAX orange) · Issued · Expires (+ red "Expired" / warn "12d left") · `Open ↗` link or "No file". Empty "No documents on record". Read-only by design.

#### Letters tab (`EmployeeLetters.tsx`)
`GET /v1/letters/generated?employeeId=&page&size=10`; heading "Generated Letters" + `+ Generate letter` (`<Can HRMS_LETTERS_GENERATE>` → `/hrms/letters/generated?employeeId=`); `DataTable` Type (purple pill) · Subject · Date · Status (VOID red / SENT info / else gray) · `View` → `/hrms/letters/generated/{id}`; `HrPagination`. Empty "No letters generated".

#### Performance tab (`EmployeePerformance.tsx`)
**Goals & KPIs** (`GET /v1/performance/kpis?ownerId=`): `TableCard` Goal (+description) · Category · Progress bar % · Target ("40 / 50 calls") · Due · Status pill (ACTIVE/COMPLETED/DROPPED/ON_TRACK/AT_RISK/OFF_TRACK). **Skills & certifications** (`GET /v1/learning/skills/{id}`): chips with proficiency bar "4/5" + "Certified" pill. Info card "Review history isn't shown here yet".

#### Exit tab (`EmployeeExit.tsx`)
**Current standing** (status pill; "Serving notice until 30 Sep 2026 · 7 days left" / "Last working day was …" / "This employee is still employed…"). **Lifecycle** rail of `Milestone`s: Joined · Probation ends · Confirmed · Notice started · Last working day/Exited. **Separation details** (reason; card rendered only when the employee is on notice or already separated) with ghost `Edit separation details` (`hrms.employee.write`) → `HrDrawer` "Edit separation details": Notice start date, Last working day, Separation reason (≤100) → `PUT /v1/hrms/employees/{id}` — footer Cancel / `Save separation details`. Card "Full & final settlement" with link `Open full & final settlements` (`/hrms/fnf`, gated `hrms.fnf.read`). Footnotes "Exited employees stay in the directory…", "Still on probation — confirm or extend from the actions at the top of this page."

### Data shown
- Header/Exit/Job base record — `GET /v1/hrms/employees/{id}` (`firstName, middleName, lastName, employeeCode, email, employmentStatus, employmentType, companyId, departmentId, designationId, branchId, reportingManagerId, dateOfJoining, probationEndDate, confirmationDate, noticeStartDate, lastWorkingDay, exitReason, ctcAnnual, hasAccount`).
- Lookups — `useCompanies/useDepartments/useDesignations/useBranches/useEmploymentTypes/useGrades`.
- Per-tab endpoints as listed above (all real; nothing mocked).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Back | top | `navigate(-1)` or `/hrms/employees` | all | LIVE |
| Change shift | profile card | `HrDrawer` "Change employee shift" (current shift line, `New shift` select "name · 09:00 – 18:00", `Effective from` date ≥ today with hint "Applies from today." / "The change is scheduled for {date}; the current shift applies until then.") → `POST /v1/shifts/employee/{id} {shiftPolicyId, effectiveFrom}`; footer Cancel / `Save shift` (or `Schedule shift change` for a future date) → toast "{name} is now on {shift}" / "{name} moves to {shift} from {date}"; load error "Unable to load shift schedules." + Try again | `attendance.regularization.approve` | LIVE |
| Edit employee (pencil) | profile card | opens `EmployeeForm` edit drawer → `PUT /v1/hrms/employees/{id}` → toast "Employee updated" | `hrms.employee.write` | LIVE |
| Confirm Probation / Confirm as permanent | chips / banner | modal → `POST …/confirm?confirmationDate=` → "Employee confirmed" | `hrms.employee.write` | LIVE |
| Extend | banner | modal → `POST /v1/probation/employees/{id}/extend?newEndDate=` → "Probation extended" | `hrms.employee.write` | LIVE |
| Start Notice / Begin exit | chips / banner | modal → `POST …/notice?noticeStart&lastWorkingDay&reason` → "Notice period started"; validates last day ≥ start | `hrms.employee.write` | LIVE |
| Cancel Notice | chip | modal → `POST …/cancel-notice` → "Notice withdrawn — employee is active again" | `hrms.employee.write` | LIVE |
| Mark Exited | chip | modal → `POST …/exit?lastWorkingDay&reason` → "Employee exited" | `hrms.employee.write` | LIVE |
| Tab ×9 | HrTabs | sets `?tab=` (replace) | per-tab perms | LIVE |
| Send invitation / Resend | Overview › Account | `POST /v1/employees/{id}/invite` / `/invite/resend` → toast "Invitation sent to {email}" / "Invitation resent" | `hrms.employee.invite` | LIVE |
| Reset face enrollment → Yes, reset / Cancel | Overview › Account | inline confirm copy "Reset Face Enrollment — clears stored face templates and unlocks any verification lockout for {name}…" → `POST /v1/attendance/face/admin/{id}/reset` → toast "Face enrollment reset — the employee can enroll again from the mobile app." | `attendance.face.admin.reset` (row hidden otherwise) | LIVE |
| Attention rows / At-a-glance tiles | Overview | switch tab | per perm | LIVE |
| Leave / Expenses links | Overview "Not on this page yet" | `navigate('/hrms/leave')`, `navigate('/hrms/expense')` | all | LIVE (note: `/hrms/expense` — the sidebar route is `/hrms/expenses`) |
| Try again | OnboardingRecord error | refetch | `hrms.employee.write` | LIVE |
| Add Address / Add Education / Add Experience / Add Dependent / Add Contact | Personal sub-section headers | open `HrDrawer` "Add Address" (submit `Save Address`) / "Add Education" / "Add Experience" / "Add Dependent" / "Add Emergency Contact" (submit `Save`, disabled until dirty & valid) → `POST /v1/employees/{id}/profile/addresses` (resp. `/education`, `/experience`, `/dependents`, `/emergency-contacts`) → toasts "Address saved" / "Education record added" / "Experience record added" / "Dependent added" / "Emergency contact added" | `hrms.employee.profile.write` | LIVE |
| Delete (trash) | Personal list rows | `DELETE /v1/employees/{id}/profile/*/{itemId}` with no confirm dialog | `hrms.employee.profile.write` | LIVE |
| Show/hide PAN, Aadhaar, Passport | Personal › Identity | toggles mask | `identity.read` | LIVE |
| Save Identity | Personal › Identity | `PUT /v1/employees/{id}/profile/identity` | `hrms.employee.identity.write` | LIVE |
| Retry | any failed sub-section | refetch | all | LIVE |
| Edit Work Details → Save Changes | Job | drawer → `PUT /v1/hrms/employees/{id}` → "Work details updated" | `hrms.employee.write` | LIVE |
| Manager avatar | Job › Reporting line | `navigate('/hrms/employees/{managerId}')` | all | LIVE |
| Page controls | Attendance › Recent records | `hrPaginationFooter` | `attendance.team.read` | LIVE |
| Revise structure / Add structure → Save structure | Payroll | drawer → `useUpsertStructure` → "Salary structure saved" | `payroll.structure.manage` | LIVE |
| Add Account → `HrDrawer` "Add Bank Account" → Add Account; delete (trash) | Payroll › Bank | `POST`/`DELETE …/profile/bank-accounts` → toast "Bank account added" | `hrms.employee.bank.write` | LIVE |
| Open Document Vault | Documents | `navigate('/hrms/documents')` | `hrms.document.write` | LIVE |
| Open ↗ | Documents row | opens `fileUrl` in new tab | `hrms.document.read` | LIVE |
| + Generate letter | Letters | `navigate('/hrms/letters/generated?employeeId=')` | `hrms.letters.generate` | LIVE |
| View | Letters row | `navigate('/hrms/letters/generated/{id}')` | `hrms.letters.read` | LIVE |
| Edit separation details → Save separation details | Exit | drawer → `PUT /v1/hrms/employees/{id}` → "Separation details saved" | `hrms.employee.write` | LIVE |
| Open full & final settlements | Exit | `Link` to `/hrms/fnf` | `hrms.fnf.read` | LIVE |
| Cancel | every drawer/modal | closes | all | LIVE |

### States
- Page loading: `CardSkeleton`. Error: `EmptyState` "Failed to load employee" + Retry (`navigate(0)`). Not found: "Employee not found — Check the details and try again." + `Back to employees`.
- Probation banner variants (ends in N days / has ended / end date not set). Notice/exited variants on Exit tab.
- Per-section `SectionState`: skeleton / `EmptyState` (copy listed per tab) / "Couldn't load this section" + Retry / forbidden (403) titles per tab. Tabs hidden when caller lacks every permission of that tab.
- Overview honesty cards: "Not on this page yet", "Payslip history isn't shown here yet", "Review history isn't shown here yet".

### Rules & permissions
- Lifecycle transitions: PROBATION → confirm/extend/notice; ACTIVE → notice; NOTICE_PERIOD → cancel-notice/exit. Last working day must be ≥ notice start; reason ≤100 chars; extend requires a new end date.
- Tab visibility is presentation only — every endpoint re-checks; attendance/documents use object-scope guards (self, direct manager, HR/admin).
- CTC shown only with `payroll.structure.read`; PII masked by default; identity write separate from profile write.
- Employment Type in Job drawer restricted to backend enum codes (custom lookup codes would 400).
- Leave/Expenses/payslip/review data intentionally absent because APIs are JWT-bound (`/v1/leave/my/*`, `/v1/expense/my`, `/v1/payroll/payslips/me`, `/v1/performance/reviews/my`).

### Gaps & plan
- **Keep:** the operational-workspace composition (Overview attention + tiles), URL-backed tabs, permission-gated sub-sections with honest "not shown yet" cards, lifecycle actions in the header, masked PII.
- **Add:** [BLUEPRINT §10.2 / PLAN §7.2] **Leave** tab (balances, history, pending) and **Expenses** tab (claims + advances) — blocked on per-employee endpoints (code comment: "no API returns either for anyone but the signed-in user"); Payroll tab **payslips** (needs `GET /v1/payroll/runs?employeeId=`); Performance **review history** (needs `GET /v1/performance/reviews?employeeId=`); Job tab **weekly offs** and **punch zone** (`PUT /weekly-offs`, `/punch-zone` exist but only in the Add/Edit wizard, not on the Job tab); Documents **upload** from the workspace ([BLUEPRINT §14 Employee Vault — Class D, P0] "Real multipart upload … `R2Storage.put()` works, only the endpoint is missing"; also [§27 P0] "document upload (multipart → existing `R2Storage`)"; today the tab is read-only and the vault is a URL box). [BLUEPRINT §10.2 header] `[Letters ▾] [Actions ▾]` menus in the header.
- **Change:** "Reporting Manager ID" is a raw UUID input in the Edit Work Details drawer — replace with an employee picker like the department-head `HrSelect`. Header lifecycle chips and the probation banner duplicate the same three actions — collapse into one `Actions ▾`. Overview links to `/hrms/expense` but the route is `/hrms/expenses`. Lifecycle chips are bespoke coloured `<button>`s — use `HrButton` variants. Initials tile duplicates `HrAvatar`.

### Screenshot
`Attach: /hrms/employees/:id — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Employee workspace" detail page (route /hrms/employees/:id) for HR_MANAGER / COMPANY_ADMIN, with reduced views for DEPT_MANAGER.
Header card: HrAvatar (lg) "Aarav Menon", code "EMP-0142", HrStatusPill "Probation" (warn), meta "Acme Technologies · Engineering · Joined 18 Sep 2026"; right-side HrButtons ghost "Change shift" (opens HrDrawer "Change employee shift": current shift line, HrSelect "New shift" ("General Shift · 09:00 – 18:00"), date "Effective from" with hint "Applies from today.", footer Cancel / "Save shift"), ghost "Edit", and one "Actions ▾" menu holding Confirm Probation / Extend probation / Start Notice / Cancel Notice / Mark Exited (show only the ones valid for the status). An amber banner under it: "Probation ends in 12 days · 30 Sep 2026" with "Confirm as permanent" / "Extend" / "Begin exit".
HrTabs (in ?tab=): Overview · Personal · Job · Attendance · Payroll · Documents · Letters · Performance · Exit (+ planned Leave, Expenses).
Overview: 2:1 grid — Employment card (InfoRows Company, Employment type "Full time", Joined, Reports to "Priya Nair", Branch "Mumbai HQ", Probation ends) and Account card ("No login account yet" + "Send invitation"/"Resend", "Reset face enrollment"); "Needs attention" list ("No salary structure — this employee cannot be included in a payroll run." → Set up payroll); "At a glance" 4 clickable tiles: This week "38h 20m / 4 present · 1 late", Salary structure "₹12,00,000 / Effective 1 Apr 2026", Documents "6 / On record", Goals "3 / Active goals & KPIs"; an "Onboarding record" card.
Attendance: 4 Metric cards (Hours, Present days, Overtime, Avg arrival) + 7-day week strip with pills On time / Late / Week off / Holiday / On leave / Absent and "09:12 → 18:40"; Shift card; TableCard "Recent records" columns Date · Status · In · Out · Hours · Late · OT · Source, hrPaginationFooter.
Payroll: 4 money cards Annual CTC ₹12,00,000 (₹1,00,000 / month) · Gross / mo · Deductions / mo · Net pay / mo; DataTable Component · Type · Monthly · Annual; History table; HrDrawer "Salary structure" (Annual CTC, Effective from, Tax regime, PF applicable, per-component monthly amounts); Bank account cards "IFSC: SBIN0001234 · ****4321" with Primary/Verified pills + HrDrawer "Add Bank Account".
Exit: status line "Serving notice until 30 Sep 2026 · 7 days left", lifecycle rail (Joined · Probation ends · Confirmed · Notice started · Last working day), Separation details + HrDrawer "Edit separation details", F&F link card.
States: CardSkeleton; EmptyState "Employee not found"; per-section SectionState empty/forbidden copy ("You don't have access to this employee's attendance"); honest info cards for data not available yet.
Keep permission-gated sections and URL tabs. Add Leave/Expenses tabs, payslips, weekly offs + punch zone on Job, document upload. Change: employee picker instead of UUID for Reporting Manager; one Actions menu instead of duplicated chips; HrAvatar for the identity tile.
```

---

## Rules & Policies  `/hrms/policies`
- **File:** `modules/hrms/Policies.tsx` (tabs `ShiftRulesTab`, `LeaveRulesTab` → embeds `leave/LeaveTypes.tsx`, `PoliciesTab`, `ManageTab`, `AcknowledgementList`)  ·  **Sidebar:** Master › Rules & Policies  ·  **Roles:** R_HR in sidebar; RouteGuard `hrms.policy.read | hrms.policy.write | hrms.policy.acknowledge.self` (so EMPLOYEE roles with acknowledge.self can open it); tabs gated: Shift Rules `attendance.regularization.approve`, Leave Rules `leave.type.write`, Documents `hrms.policy.read`, Manage `hrms.policy.write`
- **Status:** LIVE — `usePolicies → GET /v1/policy/policies?page&size&status=`, `POST /v1/policy/policies?companyId=`, `PUT/POST archive|unarchive`, `GET /v1/policy/my-acknowledgements`, `POST …/{id}/acknowledge`, `GET …/{id}/acknowledgements`; shifts `/v1/shifts`; leave types `/v1/leave/types?companyId=`. Audit: "Draft/publish/employee acknowledgement tested". Blueprint §6 row 9: Class A "Keep".

### Purpose
HR publishes policy documents employees must read and acknowledge (and tracks who has), and configures the two rule sets clients asked for: shift rules (grace period, OT rate) and leave-type rules (entitlement, carry-forward). Employees use the Documents tab to read and acknowledge.

### Layout
1. `HrPageHeader` crumb "HR Configuration", title "Rules & Policies", subtitle "Configure shift rules and leave-type rules, and publish the policy documents employees acknowledge".
2. `HrTabs` (filtered per user by `useVisibleTabs`): Shift Rules · Leave Rules · Documents · Manage.
3. **Shift Rules tab**: company `<select>` (if >1, hidden while editing); blue info banner (grace period / overtime rate explanation); form card "Add a shift rule" / "Edit shift rule": Shift name *, Shift type (Fixed/Flexible/Rotational/Night (may wrap past midnight)), Start time, End time, Grace period (minutes) 0–120, Working hours per day 0.5–24, checkbox "Overtime applicable on this shift", "Amount per OT hour (rate multiplier)" 1.0–9.99; footer ghost Cancel (edit) + primary `Add Shift Rule` / `Save Changes`. `TableCard` columns Shift (name + type) · Timing (mono "09:00 – 18:00") · Grace ("15 min") · Hours / day · Overtime (teal pill "1.5× rate" or —) · Actions (Edit, Delete); editing row highlighted mint.
4. **Leave Rules tab**: blue info banner (carry-forward explanation); "Company" `<select>` (if >1); embedded `LeaveTypes` screen (its own `HrPageHeader` — crumb "Rules & Policies", title "Leave Types", subtitle "Entitlement, paid status and carry-forward allowance per leave type" — actions ghost `Seed defaults` + primary `Add Type`; `DataTable` Leave Type · Code (`hr-mono`) · Category · Status · Edit/Deactivate; `TypeDrawer` "Add Leave Type" / "Edit Leave Type" with submit `Create Leave Type` / `Save Changes`).
5. **Documents tab**: KPI strip 3 `HrStatCard`: Active Policies (blue, server total) · Acknowledged (this page) (green) · Pending (this page) (orange); accordion of policy cards (title, category `info` pill, version, "Acknowledged" ok pill, "Effective 18 Sep 2026"); expanded body shows content + `Acknowledge` button or "✓ You acknowledged this policy"; `HrPagination` when >1 page.
6. **Manage tab**: company `<select>`; form card "Publish a policy" / "Edit policy": Title *, Category, Version, Effective date, Content (textarea); footer Cancel + `Publish Policy` / `Save Changes`. Segmented filter Active · Draft · Archived with helper text; `TableCard` (+ `hrPaginationFooter`) columns Policy · Category · Version · Acknowledged (Users icon + count, click expands `AcknowledgementList`: `HrAvatar` name/code + "18 Sep 2026, 10:42") · Status (DRAFT warn / ACTIVE ok / ARCHIVED gray) · actions Edit, Archive (ACTIVE) or Restore (ARCHIVED).

### Data shown
- Policies — `GET /v1/policy/policies?page&size=POLICIES_PAGE_SIZE&status=ACTIVE|DRAFT|ARCHIVED` (`title, category, version, effectiveDate, content, status, acknowledgementCount`).
- My acknowledgements — `GET /v1/policy/my-acknowledgements` (ids, version-scoped).
- Acknowledgement list — `GET /v1/policy/policies/{id}/acknowledgements?page=0&size=50` (`employeeName, employeeCode, acknowledgedAt`).
- Shift rules — `GET /v1/shifts?companyId=` (same rows as OrgSetup › Shifts).
- Leave types — `GET /v1/leave/types?companyId=` (`name, code, category, isActive, isCarryForwardAllowed, maxCarryForwardDays`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Tab ×4 | HrTabs | switch (local state) | per-tab perms | LIVE |
| Company `<select>` | Shift Rules / Leave Rules / Manage | scopes the tab | all | LIVE |
| Add Shift Rule / Save Changes | Shift Rules form | validations (see rules) → `POST /v1/shifts?companyId=` / `PUT /v1/shifts/{id}` → toast "Shift rule created/updated" | `attendance.regularization.approve` | LIVE |
| Cancel | Shift Rules form (edit) | resets draft | same | LIVE |
| Edit (pencil) | shift row | loads row into form | same | LIVE |
| Delete (trash) | shift row | `window.confirm` "Delete “X”? Employees still assigned to it must be moved to another shift first." → `DELETE /v1/shifts/{id}` → "Shift rule deleted" (409 `SHIFT_IN_USE` message surfaced) | same | LIVE |
| Overtime applicable | Shift Rules form | reveals rate field | same | LIVE |
| Seed defaults / Add standard Indian leave types (PL + SL + CL) | Leave Rules (LeaveTypes header / empty) | creates missing standard types → toast "N leave types added" | `leave.type.write` | LIVE |
| Add Type → Create Leave Type | Leave Rules | `TypeDrawer` "Add Leave Type" → `POST /v1/leave/types?companyId=` → "Leave type created" (toast "Name and code are required" otherwise) | `leave.type.write` | LIVE |
| Edit → Save Changes / Deactivate | leave type row | `TypeDrawer` "Edit Leave Type" → `PUT /v1/leave/types/{id}` → "Leave type updated" / `window.confirm` "Deactivate “X”? Employees will no longer be able to apply under this leave type." → `DELETE /v1/leave/types/{id}` → "Leave type deactivated" | `leave.type.write` | LIVE |
| Policy card header | Documents | expands/collapses content | `hrms.policy.read` | LIVE |
| Acknowledge | Documents expanded card | `POST /v1/policy/policies/{id}/acknowledge` → "Policy acknowledged" | `hrms.policy.acknowledge.self` | LIVE |
| Page controls | Documents / Manage | `HrPagination` | all | LIVE |
| Publish Policy / Save Changes | Manage form | `POST /v1/policy/policies?companyId=` (lands ACTIVE, filter snaps to Active) / `PUT …/{id}` → "Policy published/updated" | `hrms.policy.write` | LIVE |
| Cancel | Manage form (edit) | resets draft | same | LIVE |
| Active / Draft / Archived | Manage segmented filter | changes list status, resets page | same | LIVE |
| Acknowledged count | Manage row | toggles `AcknowledgementList` expansion | same | LIVE |
| Edit (pencil) | Manage row | loads into form | same | LIVE |
| Archive | Manage row (ACTIVE) | `window.confirm` naming the policy → `POST …/archive` → toast "“X” archived — restore it from the Archived filter" | same | LIVE |
| Restore | Manage row (ARCHIVED) | `POST …/unarchive` (no confirm) → "“X” restored — it is active for employees again" | same | LIVE |

### States
- No visible tabs: card "No policies access for this role — Ask an administrator to grant a Policies permission from Settings → Roles & Permissions."
- Shift Rules: `TableSkeleton`; empty "No shift rules yet — Add one above — attendance falls back to a 09:30 late cutoff until a shift is assigned."
- Documents: skeleton cards; empty "No active policies — Published policies will appear here for you to read and acknowledge."; expanded card with no content "No content provided for this policy."
- Manage: skeleton rows; empty per filter: "No active policies yet — publish one above." / "No draft policies." / "Nothing archived. Archived policies land here and can be restored."; acknowledgement list "No acknowledgements yet."
- Leave Rules: LeaveTypes' own states (empty state with seed CTA).

### Rules & permissions
- Acknowledgement is **per policy version**: bumping a version removes the ack and re-shows `Acknowledge`.
- List endpoint takes one status (null → ACTIVE), hence no "All" filter.
- Shift-rule validation identical to OrgSetup › Shifts; writes the only grace store attendance reads (`attendance.shift_policies`), not `settings.hr_configuration.late_grace_minutes` (Work Time Settings) nor `org.shifts`.
- Policy title required; create always lands ACTIVE (no draft-from-UI path even though DRAFT status exists).
- Documents tab body double-guarded by `hrms.policy.read`; Acknowledge needs `acknowledge.self`.

### Gaps & plan
- **Keep:** Documents accordion + version-scoped acknowledge; Manage with Active/Draft/Archived and ack drill-down; confirm-with-name on archive.
- **Add:** [code: `MANAGE_FILTERS`/`onSave`] there is a DRAFT status and filter but no way to save a policy **as draft** from the UI (create "always lands as ACTIVE") — add a "Save as draft" / "Publish" pair. [code: `PoliciesTab` stats] "Acknowledged (this page)" / "Pending (this page)" are page-local counts — needs a server aggregate. [BLUEPRINT §6 row 9] Rules & Policies is Class A "Keep", but [BLUEPRINT §7 target IA] has **no** Rules & Policies leaf: leave types sit under Leave › Leave Operations Center › Types and shifts under Time & Attendance › Shifts & Overtime, so only the policy Documents/Manage tabs need a home of their own.
- **Change:** Shift Rules duplicates OrgSetup › Shifts and Attendance › Shifts & Overtime with a third layout (inline form instead of drawer) — consolidate to one and link. Leave Rules embeds a page with its own `HrPageHeader` inside a tab (double header) — pass a headerless mode. `window.confirm` on Delete/Archive/Deactivate — use `ConfirmDialog`. Manage form sits above the table (inline) while the rest of the app uses drawers — use `HrDrawer` for Publish/Edit.

### Screenshot
`Attach: /hrms/policies — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Rules & Policies" page for HR_MANAGER / COMPANY_ADMIN (Manage, Shift Rules, Leave Rules) and EMPLOYEE (Documents only).
HrPageHeader: crumb "HR Configuration", title "Rules & Policies", subtitle "Configure shift rules and leave-type rules, and publish the policy documents employees acknowledge". HrTabs: Shift Rules · Leave Rules · Documents · Manage.
Documents tab: 3 HrStatCard — Active Policies 12 (blue), Acknowledged 9 (green), Pending 3 (orange); accordion cards "Remote Work Policy" + info pill "Workplace" + "v2.0" + ok pill "Acknowledged", sub "Effective 18 Sep 2026"; expanded body shows the text and a primary HrButton "Acknowledge" or "✓ You acknowledged this policy"; HrPagination.
Manage tab: primary HrButton "Publish Policy" opening HrDrawer (Title*, Category, Version, Effective date, Content; footer "Save as draft" / "Publish"); segmented filter Active · Draft · Archived with helper "Archived policies are hidden from employees. Restore one to publish it again."; TableCard columns Policy, Category, Version, Acknowledged (Users icon + 38, expands a list of HrAvatar "Aarav Menon / EMP-0142 · 18 Sep 2026, 10:42"), Status (DRAFT warn / ACTIVE ok / ARCHIVED gray), row actions Edit · Archive | Restore; hrPaginationFooter.
Shift Rules tab: company HrSelect, blue info banner about grace period and OT rate, HrButton "+ Add Shift Rule" → HrDrawer (Shift name*, Shift type, Start 09:00, End 18:00, Grace period (minutes) 15, Working hours per day 8, "Overtime applicable" → "Amount per OT hour (rate multiplier) 1.5"); TableCard Shift ("General / fixed"), Timing "09:00 – 18:00", Grace "15 min", Hours / day 8, Overtime teal pill "1.5× rate", Edit / Delete.
Leave Rules tab: info banner about carry-forward, company HrSelect, TableCard Leave Type ("Privilege Leave" + entitlement), Code "PL", Category "paid", Status pill, Edit / Deactivate; actions "Seed defaults" and "+ Add Type".
States: "No active policies — Published policies will appear here for you to read and acknowledge."; "No shift rules yet — attendance falls back to a 09:30 late cutoff"; "No policies access for this role".
Keep version-scoped acknowledgement and Active/Draft/Archived. Add "Save as draft". Change: drawers instead of inline forms, ConfirmDialog instead of window.confirm, no nested page header in Leave Rules.
```

---

## HR Configuration (Probation Settings)  `/hrms/settings`
- **File:** `modules/hrms/probation/ProbationSettings.tsx`  ·  **Sidebar:** HR Setup › HR Configuration  ·  **Roles:** R_HR; RouteGuard `hrms.probation.config.read`; save/scan need `hrms.probation.config.update`; reminders table needs `hrms.probation.reminders.read`
- **Status:** LIVE — `useProbationConfig → GET /v1/probation/config`, `PUT /v1/probation/config`, `useProbationReminders → GET /v1/probation/reminders`, `useTriggerProbationScan → POST /v1/probation/scan-now`. Blueprint §6 row 51 "HR Configuration · Works · Class A · Keep".

### Purpose
HR admin sets how many days before a probation end date managers and HR are emailed, whether probation auto-extends when nobody acts, and can trigger the reminder scan now; they also see the reminders already sent.

### Layout
1. `HrPageHeader` crumb "Settings", title "Probation Settings", subtitle "Configure when probation-ending reminders are sent to managers and HR."
2. Settings card (`.ut-card-lg`): `Field` "Reminder days before probation ends" (number 1–90, hint) · toggle switch "Auto-extend probation if no action is taken" · conditional `Field` "Auto-extend by (days)" (1–365) · buttons `Save settings` (primary, disabled until dirty) + `Trigger scan now` (secondary).
3. Heading "Recent reminders" + `TableCard` (`hr-table`): Employee · Type (`HrStatusPill` OVERDUE red / FINAL warn / else info) · Probation End (`d MMM yyyy`) · Sent (`d MMM yyyy, HH:mm`). Max-width 4xl.

### Data shown
- Config — `GET /v1/probation/config` (`reminderDaysBefore, autoExtendEnabled, autoExtendDays`).
- Reminders — `GET /v1/probation/reminders` (`employeeName, reminderType, probationEndDate, sentAt`).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Reminder days / Auto-extend toggle / Auto-extend by | form | local state, marks dirty | all (inputs not gated) | LIVE |
| Save settings | form | validates 1–90 → `PUT /v1/probation/config` → toast "Probation settings saved" | `hrms.probation.config.update` | LIVE |
| Trigger scan now | form | `POST /v1/probation/scan-now` → toast "Scan complete — N reminder(s) sent" | `hrms.probation.config.update` | LIVE |

### States
- Reminders loading: 3 skeleton rows; empty "No reminders sent yet"; table hidden entirely without `reminders.read`.
- Config: form shows defaults (7 / off / 90) until config arrives; no explicit loading/error UI for the config query.
- Validation toast "Reminder days must be between 1 and 90".

### Rules & permissions
- Tenant-level (no company selector) — one probation policy per tenant.
- Inputs are editable by readers; only Save/Scan are hidden without update permission.

### Gaps & plan
- **Keep:** the small, focused form; scan-now with result toast; reminders log.
- **Add:** [BLUEPRINT §7 IA › Settings] "HR Config, Holiday Calendar, Roles, Notification Templates, Integrations, Audit Logs" — the sidebar label "HR Configuration" implies a hub, but the page is only probation; Work Time Settings (`/hrms/settings/work-time`) and Holiday Calendar (`/settings/holidays`) have no link from here. [code: `useProbation.ts`] `GET /v1/probation/upcoming?days=` exists and `UpcomingProbations.tsx` is rendered on the Company Admin dashboard (`CompanyAdminDashboard.tsx`), but it is not surfaced on this page next to the reminder log.
- **Change:** sidebar says "HR Configuration", page says "Probation Settings", crumb says "Settings" — align names. Readers can edit fields they can't save — disable the form without update permission. Add loading/error state for the config query.

### Screenshot
`Attach: /hrms/settings — current screen`

### Claude Design prompt (ready to paste)
```
Design the "HR Configuration" settings page for OWNER / COMPANY_ADMIN / HR_MANAGER, currently holding Probation Settings.
HrPageHeader: crumb "HR Setup", title "HR Configuration", subtitle "Probation reminders, work-time rules and related HR defaults." Consider a left section list or HrTabs: Probation · Work time (links to /hrms/settings/work-time) · Holidays.
Probation card (max-w-4xl): Field "Reminder days before probation ends" (number, hint "How many days ahead of the probation end date to email the manager and HR (1–90)"), switch "Auto-extend probation if no action is taken", conditional Field "Auto-extend by (days)" 90; footer Button primary "Save settings" (disabled until dirty) + secondary "Trigger scan now" (toast "Scan complete — 3 reminder(s) sent").
Section "Recent reminders": TableCard columns Employee "Aarav Menon", Type HrStatusPill (red OVERDUE / warn FINAL / info UPCOMING), Probation End "30 Sep 2026", Sent "18 Sep 2026, 09:00".
Optional "Upcoming probations" TableCard (endpoint exists): Employee, Probation End, Days left, Manager.
States: skeleton rows; "No reminders sent yet"; form disabled with a note when the user lacks hrms.probation.config.update.
Keep the compact form. Add navigation to Work Time Settings and Holidays. Change: unify the label to "HR Configuration" everywhere.
```

---

## Work Time Settings  `/hrms/settings/work-time`
- **File:** `modules/hrms/organization/WorkTimeSettings.tsx`  ·  **Sidebar:** not in sidebar and **no in-app link** (grep of `apps/platform/src` finds the path only in `App.tsx`) — reachable by typing the URL  ·  **Roles:** RouteGuard `settings.hrconfig.write`
- **Status:** DEAD (unreachable by navigation) though the page itself is wired: `useHrConfig → GET /v1/settings/hr-configuration?companyId=`, `useUpdateHrConfig → PUT /v1/settings/hr-configuration?companyId=`. Audit: "/hrms/settings, work-time … Route smoke; not every configuration combination tested".

### Purpose
Per-company late-arrival grace, auto-deduction of late minutes, workweek start day and weekend days — the knobs that feed weekend/late logic in `hr_configuration`.

### Layout
1. `HrPageHeader` crumb "Master · Organisation", title "Work Time Settings", subtitle "Late-arrival grace period, auto-deduction, and workweek definition. Applies per company."
2. "Viewing for:" company bar (only if >1 company).
3. Form card (`.ut-card-lg`, max-w-3xl): "Loading current settings…" line; **Late arrival** section (Clock icon; "Grace minutes" number 0–999 with inline error; "Auto-deduct late minutes" checkbox pill Enabled/Disabled + hint) · divider · **Workweek** section ("Workweek starts on" `<select>` Monday…Sunday; "Weekend days" 7 toggle chips Mon…Sun, "Currently: Sat, Sun") · footer "Unsaved changes" (amber) + `HrButton` `Save Changes` (disabled until dirty & valid).

### Data shown
- `GET /v1/settings/hr-configuration?companyId=` → `lateGraceMinutes, enableLateAutoDeduction, workweekStartDay (1–7 ISO), weekendDays[]`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Viewing for `<select>` | top bar | switches company, clears dirty | all | LIVE |
| Grace minutes / Auto-deduct / Workweek starts on / weekend chips | form | local state, dirty | all | LIVE |
| Save Changes | form submit | `PUT /v1/settings/hr-configuration?companyId=` → toast "Work time settings saved" / "Failed to save work time settings" | `settings.hrconfig.write` | LIVE |

### States
- No company: card "Create a company first to configure its work time settings."
- Loading line while companies/config load; inline validation "Enter a whole number between 0 and 999."; "Unsaved changes" marker.

### Rules & permissions
- Grace 0–999 whole minutes; weekend days each 1–7 (defaults to Sunday only when the server returns none; workweek start defaults to Monday); hydration guarded so a refetch never clobbers an in-flight edit.
- **Important:** this `lateGraceMinutes` is NOT what attendance late-marking reads (code comment in `Policies.tsx`: only `attendance.shift_policies.grace_period_minutes` is read; `settings.hr_configuration.late_grace_minutes` is "configured-but-unread").

### Gaps & plan
- **Keep:** weekend chip picker; per-company scoping; dirty/unsaved marker.
- **Add:** [code: `App.tsx` comment] "Kept as its own top-level route (rather than folded into OrgSetup)" — it needs an entry point: link from HR Configuration or a sidebar child under HR Setup. [BLUEPRINT §7 IA › Settings] belongs with HR Config / Holiday Calendar.
- **Change:** the "Grace minutes" field misleads — attendance ignores it (see rules); either wire the backend to read it, or relabel/remove it and point to Shift rules. Crumb "Master · Organisation" while the route is `/hrms/settings/*` — align.

### Screenshot
`Attach: /hrms/settings/work-time — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Work Time Settings" page for OWNER / COMPANY_ADMIN / HR_MANAGER (permission settings.hrconfig.write), reachable from HR Configuration.
HrPageHeader: crumb "HR Setup · HR Configuration", title "Work Time Settings", subtitle "Late-arrival grace period, auto-deduction, and workweek definition. Applies per company." A "Viewing for:" bar with HrSelect "Acme Technologies".
One form card (max-w-3xl) in two sections. "Late arrival": Field "Grace minutes" 15 with hint "Punches after the shift-start + grace window count as late." and a warning note "Attendance currently scores lateness from the shift's own grace period (Rules & Policies › Shift Rules)"; Field "Auto-deduct late minutes" as a checkbox pill Enabled/Disabled with hint "When on, minutes past the grace window are subtracted from paid hours." "Workweek": HrSelect "Workweek starts on" Monday; "Weekend days" as 7 toggle chips Mon…Sun with Sat, Sun selected and caption "Currently: Sat, Sun".
Footer: amber "Unsaved changes" on the left, primary HrButton "Save Changes" (disabled until dirty and valid).
States: "Loading current settings…"; empty card "Create a company first to configure its work time settings."; inline error "Enter a whole number between 0 and 999."
Keep the chip picker. Add an entry point from HR Configuration. Change: crumb to HR Setup and clarify which grace period is authoritative.
```

---

## Notification Templates  `/hrms/notification-templates`
- **File:** `modules/hrms/NotificationTemplates.tsx`  ·  **Sidebar:** HR Setup › Notification Templates  ·  **Roles:** R_HR; RouteGuard `hrms.notiftemplate.read | hrms.notiftemplate.write`; form + row actions need `write`
- **Status:** LIVE — `useNotificationTemplates → GET /v1/notiftemplate/templates?companyId&page=0`, `POST/PUT/DELETE /v1/notiftemplate/templates[/{id}]`. Blueprint §6 row 54 "Works · Class A · Keep". (`shared/components/ModuleComingSoon.tsx` still carries a stale "notification-templates" coming-soon entry — unused by the route.)

### Purpose
HR authors the message templates (email / SMS / push / in-app) keyed to system events such as `leave.approved`, with `{{placeholders}}`, and toggles them active.

### Layout
1. `HrPageHeader` crumb "Notifications", title "Notification Templates", subtitle "Author message templates by channel and event".
2. KPI strip 3 `HrStatCard` (Bell icon): Templates (orange) · Active (green) · Channels Used (blue) — counts of the loaded page.
3. Company `<select>` (if >1).
4. Inline form card "New template" / "Edit template" (writers): Name *, Channel * (`Email / Sms / Push / In-App`), Event key * (placeholder `leave.approved`), Subject, Body * (textarea, "use {{placeholders}} for dynamic values"), checkbox Active; `HrButton` `Add Template` / `Save Changes`; "✕ Cancel" in edit mode.
5. `TableCard` (`hr-table`): Template (name + subject sub-line) · Channel (`HrStatusPill` EMAIL blue / SMS teal / PUSH purple / IN_APP orange) · Event (mono) · Status (ok Active / gray Inactive) · Actions (Edit pencil, Delete trash; writers only).

### Data shown
- `GET /v1/notiftemplate/templates?companyId=&page=0` → `content[] { name, channel, eventKey, subject, body, active }`. Only page 0 is ever requested; no pagination control.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Company `<select>` | under KPIs | scopes list | all | LIVE |
| Name / Channel / Event key / Subject / Body / Active | form | local state | `write` | LIVE |
| Add Template / Save Changes | form | validation toasts (name, event key, body required) → `POST` / `PUT …/{id}` → "Template created/updated" | `hrms.notiftemplate.write` | LIVE |
| Cancel (✕) | form header (edit) | clears form | `write` | LIVE |
| Edit (pencil) | row | loads row into form | `write` | LIVE |
| Delete (trash) | row | `ConfirmDialog` "Delete template “X”? … Any workflow wired to this template will fall back to defaults." → `DELETE …/{id}` → "Template deleted" | `write` | LIVE |

### States
- No `read` permission: `HrPageHeader` (with the shorter subtitle "Message templates by channel and event") + card "You do not have access to notification templates." (only reachable by a `write`-only role, since the route needs read or write).
- Loading: 4 skeleton rows. Empty: "No notification templates yet" + "Use the form above to author your first template." (writers) / "Templates will appear here once created."
- Errors surface only as toasts on save/delete; list errors are not rendered.

### Rules & permissions
- Name, event key, body required; subject optional; company-scoped (`companyId` sent on create/update).
- KPI counts are page-local (`templates.length`).

### Gaps & plan
- **Keep:** channel pills, event-key mono column, confirm on delete with the fallback explanation.
- **Add:** [code: `useNotificationTemplates(company, 0)`] pagination is fixed at page 0 — add `HrPagination`. [code: placeholder text] no list of available `{{placeholders}}`/event keys — a picker would prevent typos (see `docs/MERGE-FIELDS.md` for the letters engine's approach). [BLUEPRINT §27 P1] lists "payroll/expense notifications" as still-missing consumers of these templates.
- **Change:** inline form above the table → `HrDrawer`; KPI "Templates" should be `totalElements`; list-level error state; crumb "Notifications" vs sidebar group "HR Setup".

### Screenshot
`Attach: /hrms/notification-templates — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Notification Templates" page for OWNER / COMPANY_ADMIN / HR_MANAGER.
HrPageHeader: crumb "HR Setup", title "Notification Templates", subtitle "Author message templates by channel and event", action primary HrButton "+ Add Template".
KPI strip of 3 HrStatCard: Templates 14 (orange, Bell), Active 11 (green), Channels Used 3 (blue). Company HrSelect when the tenant has several companies.
TableCard with search and a Channel filter; DataTable columns Template ("Leave approved — email" + subject sub-line "Your leave has been approved"), Channel HrStatusPill (Email blue · SMS teal · Push purple · In-App orange), Event mono "leave.approved", Status (ok Active / gray Inactive), row actions ghost Edit / Delete; hrPaginationFooter "Showing 1–20 of 14".
HrDrawer "New template" / "Edit template" (max-w-lg): Name*, Channel* (HrSelect), Event key* (HrSelect of known events or free text "leave.approved"), Subject, Body* textarea with a placeholder chip row ({{employee.firstName}}, {{leave.startDate}}), checkbox Active; footer Cancel / "Add Template" | "Save Changes".
ConfirmDialog danger on delete: "Delete template “Leave approved — email”? This cannot be undone. Any workflow wired to this template will fall back to defaults."
States: skeleton rows; EmptyState "No notification templates yet / Use the form above to author your first template."; no-access card "You do not have access to notification templates."
Keep channel pills and delete confirm. Add pagination and a placeholder/event picker. Change: drawer instead of inline form.
```

---

## Integrations Directory  `/hrms/integrations`
- **File:** `modules/hrms/Integrations.tsx`  ·  **Sidebar:** HR Setup › Integrations  ·  **Roles:** R_HR; RouteGuard `hrms.integration.read | hrms.integration.write`; add/toggle/remove need `write`
- **Status:** LIVE (as a registry) — `useIntegrationConnections → GET /v1/integration/connections?companyId&page` (20/page), `POST /v1/integration/connections`, `POST …/{id}/toggle`, `DELETE …/{id}`. Audit: "Real record CRUD; manual status only; provider adapters missing" [FUNCTIONALITY_AUDIT › Live module inventory]; [IMPLEMENTATION_STATUS › Important limits] "a persisted configuration registry, not provider OAuth or synchronization".

### Purpose
An admin keeps a truthful list of which third-party services (Slack, bank, SMS…) have been configured for a company and marks them configured / unconfigured by hand. It does not connect, authorise or sync anything — and says so.

### Layout
1. `HrPageHeader` crumb "Integrations", title "Integrations Directory", subtitle "Track third-party service configuration records".
2. Disclaimer line: "Status is recorded manually. Adding a record here does not authorize the provider or synchronize data."
3. Error card (role=alert) with `Retry` when the list fails.
4. KPI strip 3 `HrStatCard`: Registered services (blue, `totalElements`) · Marked configured (this page) (green) · Needs attention (this page) (orange).
5. Company `<select>` (if >1).
6. Inline add card (writers): Name, Provider, Category inputs + `HrButton` `+ Add Integration`.
7. `TableCard` (`hr-table`): Integration (name + `configSummary`) · Provider · Category · Status (`HrStatusPill` CONNECTED ok "Marked configured" / DISCONNECTED gray "Not configured" / ERROR red "Needs attention") · Registered (`lastSyncedAt` as `d MMM yyyy, HH:mm` or —) · Actions (`HrButton sm` "Mark configured" / ghost "Mark unconfigured", trash Remove).
8. `HrPagination` (pageSize 20).

### Data shown
- `GET /v1/integration/connections?companyId=&page=` → `content[] { name, provider, category, status, configSummary, lastSyncedAt }`, `totalElements, totalPages`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Company `<select>` | under KPIs | scopes list, resets page | all | LIVE |
| Retry | error alert | `refetch()` | all | LIVE |
| Name / Provider / Category | add card | local state | `write` | LIVE |
| + Add Integration | add card | validation toasts (company, name, provider) → `POST /v1/integration/connections` → "Integration added"; clears form | `hrms.integration.write` | LIVE |
| Mark configured / Mark unconfigured | row | `POST …/{id}/toggle` → "Integration registry status updated" | `write` | LIVE (manual flag only) |
| Remove (trash) | row | `ConfirmDialog` "Remove {name}? The {provider} connection and its stored credentials will be deleted…" → `DELETE …/{id}` → "Integration removed" | `write` | LIVE |
| Page controls | `HrPagination` | page change | all | LIVE |

### States
- Loading: 4 skeleton rows. Empty: "No integrations yet" + "Use the form above to add your first connection." / "Connections added by an admin will appear here."
- Error: alert card + Retry (list stays rendered underneath).
- No-permission: RouteGuard; write controls hidden.

### Rules & permissions
- Name + provider required; category optional; company-scoped.
- Status is a manual flag; `lastSyncedAt` is no longer fabricated on toggle ([FUNCTIONALITY_AUDIT › Static/no-op findings resolved]), so "Registered" is usually "—".

### Gaps & plan
- **Keep:** the honest disclaimer and wording ("Marked configured"); confirm on remove; pagination.
- **Add:** [HANDOFF §10 F] "For required providers add real configuration, secure backend-held credentials, connection tests, actual sync jobs, idempotency, truthful health/last-success timestamps, error/retry reporting and disconnect behavior" — blocked on the provider list ([IMPLEMENTATION_STATUS] "requested external integration providers/test-account configuration are still unanswered"). [HANDOFF §12 / STATUS limits] do not fake a provider connection.
- **Change:** column "Registered" shows `lastSyncedAt` (a sync concept the registry doesn't have) — rename to "Last verified" or drop. Inline add card → `HrDrawer` with a Provider picker. "Needs attention (this page)" counts are page-local.

### Screenshot
`Attach: /hrms/integrations — current screen`

### Claude Design prompt (ready to paste)
```
Design the "Integrations Directory" page for OWNER / COMPANY_ADMIN / HR_MANAGER.
HrPageHeader: crumb "HR Setup", title "Integrations Directory", subtitle "Track third-party service configuration records", action primary HrButton "+ Add Integration". Directly under it a muted note: "Status is recorded manually. Adding a record here does not authorize the provider or synchronize data."
KPI strip of 3 HrStatCard: Registered services 5 (blue, Boxes), Marked configured 3 (green, PlugZap), Needs attention 1 (orange, AlertTriangle). Company HrSelect when needed.
TableCard: DataTable columns Integration ("Payroll Slack alerts" + config summary sub-line), Provider "Slack", Category "Communication", Status HrStatusPill (ok "Marked configured" · gray "Not configured" · red "Needs attention"), Last verified "18 Sep 2026, 10:42" or "—", row actions HrButton sm "Mark configured" / ghost "Mark unconfigured" and ghost Remove; HrPagination 20 per page.
HrDrawer "Add Integration": Name*, Provider* (HrSelect with free text), Category, footer Cancel / "Add Integration".
ConfirmDialog danger on Remove: "Remove Payroll Slack alerts? The Slack connection and its stored credentials will be deleted. This cannot be undone."
States: skeleton rows; EmptyState "No integrations yet / Use the form above to add your first connection."; error alert card with Retry above the table.
Keep the registry honesty (no fake sync). Do not add OAuth/sync UI until providers are chosen (Handoff §10 F). Change: drawer instead of inline form; rename "Registered" column.
```
