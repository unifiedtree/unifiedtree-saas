# Workforce: Phase 0 audit (read-only)

Area: Workforce directory, Add employee, Import employees, Master overview, Organization setup, Rules & policies.
Checked against `main` at `e32a4dc6` on 27 Sep 2026.

Design files:
- `PgDirectory.dc.html`: the directory, with the stat cards from `UtStat.dc.html`.
- `PgEmpForm.dc.html`: Add employee.
- `PgEmpImport.dc.html`: Import employees.
- `PgOrg.dc.html` with `mode=overview`: Master overview.
- `PgOrg.dc.html` with `mode=setup`: Organization setup.
- `PgSetup.dc.html`, page key `m-rules`: Rules & policies.
- Navigation model: `hrms-core.js` → `M.workforce`.

**Legend.**
- **Exists**: the API and hook give this today.
- **Partial**: some of it is there; what's missing is named.
- **Missing**: nothing gives it today.

**Sizes.**
- **S**: half a day or less.
- **M**: 1 to 2 days.
- **L**: 3 days or more.

**How it was checked.**
- Everything here comes from reading the code and the migrations.
- The recovery API (`127.0.0.1:8080`) and database (`127.0.0.1:55432`) were not running during the audit, so no live GET or SQL call was possible.
- Which roles hold which permission comes from the migrations: `V027`, `V065`, `V066`, `V075`, `V143_5` and `V143_22`.

---

## 1. Navigation: design against today

In the design, the module is **Workforce**, in the rail's **People** section, with the database icon. It has 4 pages:
- `m-over` Master overview: no tabs.
- `m-dir` Workforce directory: tabs Active, Probation, On notice, Exited, Suspended.
- `m-org` Organization setup: tabs Departments, Designations, Grades, Agencies.
- `m-rules` Rules & policies: tabs Policies, Shift rules, Leave rules, Manage policies.

Add employee and Import are sub-pages of the directory. The prototype opens them as `mode: 'add'` and `mode: 'import'`, each with a "← Workforce directory" back link.

Today the rail group is **Master** (`PlatformShell.tsx` `MODULE_ITEMS` key `master`, `RAIL_LABELS.master = 'Master'`). Menus are permission-only:
- `isVisible()` → `menuRule(path, group)` → the `pageRegistry.ts` entry.
- The `visibleForRoles` lists are no longer read.

| Design page | Menu item today | Route(s) today | Menu / search rule (`pageRegistry.ts`) | Route guard (`App.tsx`) |
|---|---|---|---|---|
| Master overview | Master › Overview | `/hrms/master` | `page('master', …, [{ anyOf: MASTER_ANY, module: HR }])`. `MASTER_ANY` = hrms.employee.read, hrms.department.write, hrms.branch.write, hrms.designation.write, hrms.contractor.read, leave.type.write, hrms.policy.write, attendance.workforce.admin, payroll.components.read, payroll.settings.read | `/hrms/master/*`: `RouteGuard anyOf` the same 10 codes, then `ModuleGate hrms` |
| Workforce directory | Master › Workforce Directory | `/hrms/employees` | `page('employees', …, [{ ...any('hrms.employee.read'), module: HR }])` | `RequirePermission code={P.HRMS_EMPLOYEE_READ}` + `RouteGuard anyOf={[P.HRMS_EMPLOYEE_READ]}` |
| Add employee (sub-page) | a drawer inside the directory | none. `/hrms/employees?add=1` is linked from the dashboards but **ignored** (bug) | action `add-employee` → `/hrms/employees` (`actionRegistry.ts`) | as the directory |
| Import (sub-page) | no menu item | `/hrms/employees/import` | `page('employee-import', …, [{ ...any('hrms.employee.import') }])` | `RouteGuard anyOf={[P.HRMS_EMPLOYEE_IMPORT]}` |
| Organization setup | Master › Organization Setup (Companies, Branches, Departments, Designations, Grades & Bands). Agencies is today "Contractor Master" under the Workforce Directory group | `/hrms/organization`, `/hrms/master/{companies,branches,departments,designations,grades,contractors}` | `organization`: `anyOf: ORG_SETUP` (hrms.department.write, hrms.branch.write, hrms.designation.write). `m-departments`: ORG_SETUP + allOf hrms.department.read. `m-designations`: ORG_SETUP + hrms.designation.read. `m-grades`: ORG_SETUP. `m-contractors`: hrms.contractor.read | `/hrms/organization`: `anyOf [HRMS_DEPARTMENT_WRITE, HRMS_BRANCH_WRITE, HRMS_DESIGNATION_WRITE]`. Others: `/hrms/master/*` |
| Rules & policies | Master › Rules & Policies (`path '/hrms/master/shift-rules'`, `also ['/hrms/policies']`) | `/hrms/master/shift-rules`, `/hrms/master/leave-rules`, `/hrms/policies` | `m-shift-rules`: any(attendance.workforce.admin, hrms.policy.write). `m-leave-rules`: any(leave.type.write, hrms.policy.write). `policies`: any(hrms.policy.read, hrms.policy.write, hrms.policy.acknowledge.self) | `/hrms/policies`: `anyOf ['hrms.policy.read','hrms.policy.write','hrms.policy.acknowledge.self']`. Then `PoliciesRoute`: holding **both** write and read → Master Policy Documents; anyone else → `Policies.tsx` |
| *(not in design)* | Master › Payroll Configuration | `/hrms/payroll/components`, `/hrms/master/statutory` | `components`: payroll.components.read, module payroll. `m-statutory`: payroll.settings.read | `/hrms/payroll/components`: `PAYROLL_COMPONENTS_READ`, `ModuleGate payroll` |
| *(not in design)* | Master › Classification Rules | `/hrms/master/classifications` | `m-classifications`: hrms.employee.read | `/hrms/master/*` |

Inside the page, the Master container decides what shows. `MasterContainer.tsx` lines 136–145 set `visible` and `writable`:
- **visible**:
  - employees and classes: `hrms.employee.read`
  - contractors: `hrms.contractor.read`
  - companies and branches: `orgSetup && org.company.read`
  - departments: `orgSetup && hrms.department.read`
  - designations: `orgSetup && hrms.designation.read`
  - grades: `orgSetup`
  - shifts: `attendance.workforce.admin || hrms.policy.write`
  - leaves: `leave.type.write || hrms.policy.write`
  - policies: `hrms.policy.write && hrms.policy.read`
  - `orgSetup` = department.write, branch.write or designation.write.
- **writable**:
  - employees: `hrms.employee.write`
  - agencies: `hrms.contractor.write`
  - classes: `hrms.employment-type.write`
  - companies and branches: `org.company.write`
  - depts: `hrms.department.write`
  - desigs: `hrms.designation.write`
  - grades: `hrms.grade.write`
  - shifts: `attendance.workforce.admin`
  - leaves: `leave.type.write`
  - policies: `hrms.policy.write`

**Shell details that touch these pages.**
- `OWN_SECTION_BAR` and `ownsSectionBar()` hide the shell's sub-nav on `/hrms/employees`, `/hrms/organization`, `/hrms/policies`, `/hrms/payroll/components`, `/hrms/master/*` and `/hrms/employees/:id`.
- On those pages the generated `TopTabs` draws a "Master sections" nav instead: Overview plus the group tabs.
- In the redesign, the shell's Pages button and pill tabs replace it.

**Proposed URL map.** Every current URL keeps working.

| Design place | URL |
|---|---|
| Master overview | `/hrms/master` |
| Directory | `/hrms/employees`, tab in `?status=` (the existing parameter; see Q1) |
| Add employee | `/hrms/employees?add=1`. `/hrms/employees/new` could also be added: a fixed segment ranks above `:id`, as `/import` already does. |
| Import | `/hrms/employees/import` |
| Organization setup | `/hrms/organization` opens the first tab the person may open |
| Organization setup tabs | `/hrms/master/departments`, `/hrms/master/designations`, `/hrms/master/grades`, `/hrms/master/contractors` (Agencies) |
| Rules & policies | `/hrms/master/shift-rules` (Shift rules), `/hrms/master/leave-rules` (Leave rules), `/hrms/policies` (Manage policies for authors, Policies for others). New: `/hrms/policies?view=documents`, so authors get their own Policies tab too. |
| Pages with no design home | `/hrms/master/{companies,branches,classifications,statutory}`, `/hrms/payroll/components` (Q10) |

---

## 2. Screens

### 2.1 Workforce directory: `PgDirectory.dc.html` (list mode)

**Repo.**
- Route `/hrms/employees` → `modules/hrms/master/MasterContainer.tsx` (page `employees`).
- That renders the generated `design/master/MasterDesign.tsx`:
  - `EmployeesPage` (lines 221–280)
  - `EmpProfile` drawer (281–298)
  - `EmpForm` drawer (299–316)
  - the Start exit `Modal`
- Records are built by `master/masterData.ts` `employeeRec()`. Saves go through `master/masterSync.ts` `employees()` and `saveEmployee()`.
- `MasterDesign.tsx` is generated by `scripts/master-build.mjs` + `master-patches.mjs`. **Do not hand-edit it.**
- The page exists, in a different layout.

**Data sources today.** Queries defined inline in `MasterContainer.tsx`:
- `empQ`: `['hrms','employees','master-all']`. `loadDirectory()` calls `GET /v1/hrms/employees?page=N&pageSize=200` for up to 25 pages, so at most 5,000 people.
  - Server: `@PreAuthorize("hasAuthority('hrms.employee.read')")`. Active rows only (`is_active`), every status.
- `branchesQ`: `GET /v1/hrms/branches`. Needs `org.company.read`.
- `depts`: `GET /v1/hrms/departments?companyId=` per company. Needs `hrms.department.read`.
- `desigs`: `GET /v1/hrms/designations?companyId=`. Needs `hrms.designation.read`.
- `types`: `GET /v1/hrms/employment-types?companyId=`. Any signed-in user.
- `schedQ`: `GET /v1/team/schedule?from=today&to=today`. Needs `attendance.team.read`. Gives each person's current shift.
- `milestoneQ`: `GET /v1/hrms/employees?milestone=&milestoneFrom=&milestoneTo=`.

**Data points.**

| # | Data point (design) | Source today | Status |
|---|---|---|---|
| D1 | Sub-line "N people across B branches and D departments": N | count from `empQ` | exists (count done in the browser) |
| D2 | … B branches | `branchesQ` | exists |
| D3 | … D departments | `depts` | exists |
| D4 | Stat **Active**: value | count from `empQ`, or `LiveHeadcount` on the server (ACTIVE+PROBATION+NOTICE_PERIOD) | exists |
| D5 | Active: delta "+6 this month" (trend arrow) | net joiners this month, from `dateOfJoining` / `lastWorkingDay` in `empQ`. No server figure. `hrms.employee_status_history` (V143_27) would give the exact one | partial |
| D6 | Active: 7-point sparkline | could be worked out from join and exit dates, as the Headcount spark already is (`EmployeesPage` `spark`). No server series | partial |
| D7 | Stat **On probation**: value | count of `PROBATION` in `empQ`. `GET /v1/hrms/employees/counts` does **not** break out probation | exists (browser count) |
| D8 | Probation: "3 · reviews due in Oct" | `probationEndDate` in `empQ`, or `useUpcomingProbations(days)` → `GET /v1/probation/upcoming?days=` (`hrms.employee.read`) | exists |
| D9 | Stat **On notice**: value | count of `NOTICE_PERIOD` | exists |
| D10 | Notice: "+1 since last week" | `noticeStartDate` in `empQ` | exists (browser count) |
| D11 | Stat **Suspended**: value | count of `SUSPENDED` (the enum exists; `?status=SUSPENDED` filters). Nothing in the UI ever sets it | exists (almost always 0) |
| D12 | Suspended: "Review · pending inquiry" | no suspension reason or case data anywhere. The date it started could come from `employee_status_history` | missing |
| D13 | Stat **Exited this year**: value | EXITED/TERMINATED with `lastWorkingDay ≥ 1 Jan` in `empQ` | exists (browser count) |
| D14 | Exited: "4.1% attrition" | `useAttritionReport()` → `GET /v1/reports/attrition` (`@perm.check('hrms.report.attrition')`), else worked out in the browser | partial |
| D15 | Payroll filter: whether each person is paid through payroll | employment type code → `GET /v1/hrms/employment-types` `payrollEligible`. This is the same "Paid through payroll / Not paid through payroll" wording Classification Rules shows. The **payroll engine never reads this flag** | partial (Q3) |
| D16 | "Include inactive": exited people added to the Active tab | browser filter on `empQ` | exists |
| D17 | Department filter options | `depts` (sub-teams and "No department" today) | exists |
| D18 | Branch filter options | `branchesQ` | exists |
| D19 | Type filter options | employment types (`types`) | exists |
| D20 | Count label: "N people shown" or "N match “q”" | browser | exists |
| D21 | Selection count: "n selected" | browser | exists |
| D22 | Row: avatar initials and name | `firstName` / `middleName` / `lastName` | exists |
| D23 | Row: email | `email` | exists |
| D24 | Row: code | `employeeCode` | exists |
| D25 | Row: designation | `designationId` → `desigs` title | exists |
| D26 | Row: department · employment type | `departmentId` → `depts`, `employmentType` | exists |
| D27 | Row: branch | `branchId` → `branchesQ`. Shows "—" without `org.company.read` | exists |
| D28 | Row: reporting manager | `reportingManagerId` → name from `empQ`. Today it shows only in the drawer | exists |
| D29 | Row: date of joining | `dateOfJoining` | exists |
| D30 | Row: status pill and tone | `employmentStatus` (TERMINATED shows "Terminated" in the Exited tab) | exists |
| D31 | Cards view: the same fields | as D22–D30 | exists |
| D32 | Which tab each person is in (the Active tab = everyone not Exited or Suspended, per the prototype's `DR_TAB`) | browser | exists (Q1 on meaning) |
| D33 | Empty state: "No one here yet · Try another tab or clear the search." | browser | exists (copy) |
| D34 | Search `?q=` matching (the prototype searches name, code, dept, role, branch) | today: substring of name+code+email+designation over `empQ`. The global search finds "sales priya" word by word on the server, but the directory's own filter would not match it | partial |

**Actions.**

| # | Action | API today | Permission (server) | Status |
|---|---|---|---|---|
| A1 | Import (header) | navigates to `/hrms/employees/import` | `hrms.employee.import`. Today the button **shows to everyone** and says "You don’t have access…" if not allowed (`act.importEmployees`) | exists (hide the button without permission) |
| A2 | Export (header) | CSV of the rows shown, built in the browser, logged through `saveAndRecord` (Reports → Recent downloads). The server version is `GET /v1/hrms/employees/export.csv` | `hrms.employee.read` | exists |
| A3 | Add employee (header) | opens Add employee | `hrms.employee.write`. Today the button **shows to everyone**; saving fails with "You don’t have access to change this" | exists (hide the button without permission) |
| A4 | Click a stat card → its tab | URL `?status=` | read | exists (status filter) |
| A5 | Pill tabs in the top bar | same | read | exists (needs the shell) |
| A6 | Table / Cards toggle | UI | none | missing (UI only, S) |
| A7 | Payroll filter (All / Paid / Not paid) | UI over D15 | none | partial (Q3) |
| A8 | Include inactive | UI | none | missing (UI only, S) |
| A9 | Department filter | UI | none | exists |
| A10 | Branch filter | UI | none | exists |
| A11 | Type filter | UI | none | exists |
| A12 | Click a row → full profile | `/hrms/employees/:id` (`EmployeeDetail`). Guard: `anyOf [HRMS_EMPLOYEE_READ, ATTENDANCE_TEAM_READ]` | read | exists. Today a click opens the quick drawer, whose "Full record" goes on to the profile |
| A13 | Select a row / select all | UI | none | exists |
| A14 | Bulk **Assign shift** | `POST /v1/shifts/employee/{id}` `{shiftPolicyId, effectiveFrom}`, one call per person (`assignEmployeeShift`). No bulk endpoint | `attendance.workforce.admin` | partial |
| A15 | Bulk **Send letter** | `POST /v1/letters/distributions` with `recipientFilter.employeeIds` (a custom list); `DistributionWizard` can't be pre-filled yet | `hrms.letters.distribute` | partial |
| A16 | Bulk Export | as A2 | read | exists |
| A17 | Clear selection | UI | none | exists |
| A18 | Search: the page filter from the top-bar search ("On this page"), with a chip to clear it | the global search links people to `/hrms/employees?q=`. Today an inline box is pre-filled from `?q=` | read | partial (the shell must offer the page filter; see D34) |

**Current features the design leaves out. Keep them (conflicts C1–C4).**
- Bulk **Change status** (Mark as active / probation), through `masterSync.saveEmployee`:
  - `POST /v1/hrms/employees/{id}/confirm`
  - `POST …/cancel-notice`
  - `PUT` with `employmentStatus`
  - Needs `hrms.employee.write`.
- **Row menu** (View profile, Edit details, Start exit):
  - Start exit calls `POST …/notice` or `POST …/exit` (`hrms.employee.write`).
  - The Start exit dialog uses the shared `DateField`.
- **Milestone filter** (`?filter=birthday|anniversary|retirement&from&to`). The dashboard's "View all" and `milestoneRange.ts` depend on it.
- The **status dropdown** and the **pager** (10 per page).
- The **quick profile drawer**.

**Permissions quoted.**
- pageRegistry `any('hrms.employee.read')`.
- `App.tsx` `RequirePermission code={P.HRMS_EMPLOYEE_READ}`.
- Backend `@GetMapping("/employees") @PreAuthorize("hasAuthority('hrms.employee.read')")`.
- `@GetMapping("/employees/export.csv") @PreAuthorize("hasAuthority('hrms.employee.read')")`.
- Stats need the same `hrms.employee.read`.
- Attrition % needs `hrms.report.attrition`.

**Bugs found here.**
- `?add=1` is ignored, although `AdminDashboard.tsx:254` and `HrmsDashboard.tsx:297` link to it.
- `?companyId=` from `CompaniesPage.tsx:90,184` is ignored: `route.co` reads only `co`, and `EmployeesPage` never filters by company.
- Import and Add employee show without their permissions.

### 2.2 Add employee: `PgEmpForm.dc.html`

**What the design shows.** A full page:
- a back link, the title "Add employee" and "Three short steps. You can save a draft and finish later."
- a pill stepper: Basic, Financial, Review
- an "out of seats" banner
- field groups
- the Review block with an Edit link per section
- an aside with a dark-green **Preview** card (initials, name, role, code, joining date) and "What happens next"
- a sticky footer: Save draft, Back, Continue / Add employee

**Repo.** Two forms exist today:
1. **Master drawer** `EmpForm` (the `RecordForm` drawer in `MasterDesign.tsx:299`). This is what the directory's Add employee opens.
   - Sections: Personal (first, last, email, mobile), Employment (company, branch, department, designation, type, date of joining, shift, and a staffing agency for Contract), then **Access** (`MasterAccessStep.tsx` → `rbac/components/AccessPicker.tsx`) for people with the rights.
   - It saves through `masterSync.employees()`:
     - `POST /v1/hrms/employees` with `roleCode: 'EMPLOYEE'`
     - `assignEmployeeShift`
     - agency link `PUT /v1/hrms/contractors/{id}/workers/{empId}`
     - `sendInvite` → `POST /v1/employees/{id}/invite`
     - `applyNewPersonAccess()` (`rbac/api/newPersonAccess.ts`)
2. **The old 3-step wizard** `employees/EmployeeForm.tsx` (1,548 lines): Basic, Financial, Review, with exactly the design's field set.
   - Today it is used **only for editing**, from `EmployeeDetail.tsx:347` ("All fields…").
   - Its create path still works. It has:
     - phone, gender and date-of-birth checks, and a block on future joining dates
     - format checks for PAN, Aadhaar, UAN, ESI, IFSC and account number
     - dedupe recovery
     - the 402 out-of-seats panel
     - an unsaved-changes guard
     - inline "+ Add" for company, department, designation and zone
     - a "Send invitation email" checkbox
     - `reportingManagerId` for department managers

**Recommendation.** Build the new page on `EmployeeForm.tsx`'s logic, which already matches the design's steps. Add the Master drawer's Branch, Staffing agency and Access. Keep the edit mode that `EmployeeDetail` uses.

**Data points.**

| # | Data point | Source | Status |
|---|---|---|---|
| E1 | Out-of-seats banner | `useSeatsUsage()` → `GET /v1/workspace/seats/usage` (any signed-in user), plus the 402 from create (`SeatQuotaEnforcer`) | exists |
| E2 | Company options | `useCompanies()` → `GET /v1/hrms/companies` (`org.company.read`) | exists |
| E3 | Department options | `useDepartments(companyId)` → `GET /v1/hrms/departments?companyId=` (`hrms.department.read`) | exists |
| E4 | Designation. The design shows a **text** box; today it's a list, with free text when the company has none (the server's `resolveOrCreateDesignation`) | `useDesignations(companyId, deptId)` (`hrms.designation.read`) | exists (keep the list) |
| E5 | Employee code "Auto · Suggested from the last code" | `useNextEmployeeCode()` → `GET /v1/settings/employee-code/preview?companyId=` (`settings.read` or `hrms.employee.write`) | exists |
| E6 | Report To options, and who it defaults to | the directory list (`hrms.employee.read`). `CreateWorkforceEmployeeRequest.reportingManagerId` is accepted; without it the server picks the department head (`resolveReportingManager`). Neither form offers a picker today | partial (UI only) |
| E7 | Employment type options | `useEmploymentTypes()` → `GET /v1/hrms/employment-types` (any signed-in user), filtered to the server's list (FULL_TIME, PART_TIME, CONTRACT, INTERN, CONSULTANT) | exists |
| E8 | Punch location, shown as "Bengaluru HQ · 150 m" | branch check-in areas `GET /v1/hrms/branches` (`geoFenceRadiusMeters`, lat/long); old per-person zones `useGeofenceZones()` → `GET /v1/attendance/geofence/zones` (`attendance.team.read`). A punch uses the person's zone if set, else their branch (`CanonicalAttendanceService` ~line 576) | partial |
| E9 | "Anywhere (no geofence)" | there's only the company switch "Require geofencing on mobile"; no per-person exemption | missing |
| E10 | Shift options, with times | `useShiftPolicies()` → `GET /v1/shifts?companyId=` (`attendance.checkin.self`) | exists |
| E11 | Weekly off presets, including "2nd and 4th Sat, Sun" | stored as `weeklyOffDays` CSV of ISO days (1–7). Alternating Saturdays can't be stored | partial (Q6) |
| E12 | Gender options | enum MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY | exists |
| E13 | Salary frequency and monthly salary, "Used for the first pay run" | saved on the employee record (`monthly_salary`, `salary_frequency`, `ctc_annual`). Payroll pays from **salary structures**, not this field | partial (the copy isn't true today) |
| E14 | Bank name as a list | free text today | partial |
| E15 | Field errors ("Required", "PAN looks like ABCDE1234F") | in the browser (`EmployeeForm` `RX`) | exists (but see C7 on which fields are required) |
| E16 | Review rows, with Aadhaar and account masked | browser | exists |
| E17 | Preview card: initials, name, role · department, code, joining date | browser, plus E5 | exists |
| E18 | "What happens next: an onboarding run starts, the reporting manager is told, and a welcome email goes to the work address" | welcome email = the invitation (`hrms.employee.invite`). **No onboarding run starts** on a direct add (`WorkforceEmployeeService.create` has no hook). **No manager notice** | partial |
| E19 | Branch (required in the Master drawer; not in the design) | `GET /v1/hrms/branches`. If left empty, the server uses the company's only active branch | exists (keep it) |
| E20 | Staffing agency (Contract type; not in the design) | `GET /v1/hrms/contractors` (`hrms.contractor.read`) | exists (keep it) |
| E21 | Access: roles and single permissions (not in the design) | `useAssignableRoles()` → `GET /v1/workspace/assignable-roles`; `usePermissionsCatalogue()` → `GET /v1/rbac/permissions`; each role's permissions `GET /v1/rbac/roles/{id}/permissions` (needs `rbac.role.write` to read). Shown only when `useNewPersonAccessRights().visible`, which is `workspace.users.read && (workspace.users.manage \|\| rbac.access.manage-overrides)` | exists (keep it) |

**Actions.**

| # | Action | API | Permission | Status |
|---|---|---|---|---|
| X1 | Back to the directory | UI | none | exists |
| X2 | Click a finished step pill | UI (the old wizard goes back only) | none | exists |
| X3 | Continue (checks this step) | UI | none | exists |
| X4 | Back (previous step) | UI | none | exists |
| X5 | **Save draft** ("Find it under Drafts in the directory") | nothing | none | **missing** (new table; Q5) |
| X6 | **Add employee** | 1. `POST /v1/hrms/employees` (`hrms.employee.write`). 2. `POST /v1/shifts/employee/{id}` (`attendance.workforce.admin`). 3. `PUT /v1/hrms/contractors/{a}/workers/{id}` (`hrms.contractor.write` or `hrms.employee.write`). 4. `POST /v1/employees/{id}/invite` (`hrms.employee.invite`). 5. access: `POST /v1/workspace/users/{id}/roles` (`workspace.users.manage`) and `PUT /v1/workspace/users/{id}/permissions` (`rbac.access.manage-overrides`) | as listed | exists. Onboarding start and manager notice are missing (E18) |
| X7 | Add seats | opens `/plan`, for plan admins only (`canManageBilling` in `EmployeeForm`: OWNER, SUPER_ADMIN, COMPANY_ADMIN) | role-based on the server (`WorkspacePlanController`) | exists |
| X8 | Edit a section from Review | UI | none | exists |
| X9 | Unsaved-changes guard (not in the design) | `beforeunload` + link intercept in `EmployeeForm` | none | exists (keep it) |
| X10 | Inline "+ Add" company, department, designation, zone (not in the design) | `InlineCreateModals.tsx`: `org.company.write`, `hrms.department.write`, `hrms.designation.write`, `org.geofence.write` | as listed | exists (optional) |

**Bugs.**
- `EmployeeForm.tsx:276` gates the shift picker on `attendance.regularization.approve`, but `POST /v1/shifts/employee/{id}` checks `attendance.workforce.admin` (`ShiftController:158`).
- A role with the first but not the second sees the picker and gets "Employee updated, but … could not be assigned". Use `attendance.workforce.admin`, as `MasterContainer` does.

### 2.3 Import employees: `PgEmpImport.dc.html`

**Repo.**
- `/hrms/employees/import` → `modules/hrms/employees/EmployeeImport.tsx` (on the module kit).
- Hooks in `modules/hrms/api/useBulkImport.ts`:
  - `useDownloadTemplate`
  - `useValidateBulkImport`
  - `useCommitBulkImport`
  - `parseErrors`
  - `countValidRows`
- Backend `app/bulk/BulkImportController.java`: all 3 endpoints check `@PreAuthorize("@perm.check('hrms.employee.import')")`. Service: `EmployeeBulkImportService.java`.
- Who holds `hrms.employee.import`: SUPER_ADMIN, HR_MANAGER and OWNER. FINANCE_LEAD lost it in V066.
- The page exists.

**Data points.**

| # | Data point | Source | Status |
|---|---|---|---|
| I1 | Required column chips. Design: Employee code, First name, Last name, Work email, Department, Designation, Date of joining, Employment type | server template requires only `first_name, last_name, email, employment_type, date_of_joining` (typed into `EmployeeImport.tsx`) | partial |
| I2 | Optional column chips. Design: Branch, Reporting manager, Phone, Date of birth, PAN, UAN, Bank account, IFSC | server: `phone, department, designation, job_title, gender, date_of_birth`. Missing: employee code, branch, reporting manager, PAN, UAN, bank account, IFSC. **`department` is read but thrown away**: `toRequest()` passes `null` for department, branch and manager | partial, plus a bug |
| I3 | File name / drop-zone title | browser | exists |
| I4 | Rows in the file | `BulkImportResult.totalRows` | exists |
| I5 | Ready | `countValidRows()` | exists |
| I6 | Problems count and its note | `errorCount` | exists |
| I7 | Problems table: row | parsed from "Row N: message" | exists |
| I8 | Problems table: **column** | only inside the message text ("email already exists: …"). No structured field | partial |
| I9 | Problems table: problem | message | exists |
| I10 | Warnings that don't block ("Date is in the past month; is that right?") | none | missing |
| I11 | "Import blocked by validation errors" | browser | exists |
| I12 | "Import N people" | ready count | exists |
| I13 | "Creating employees…" progress | upload progress (XHR) only; nothing reports progress on the server | partial |
| I14 | "N people were added" | `successCount` | exists |
| I15 | "… and their onboarding runs have started" | the import creates through the older `EmployeeService.createEmployee` with `onboardingTemplateId = null`, so **no run starts** | missing |
| I16 | Which company to import into (not in the design; needed with more than one company) | `useCompanies()` | exists (keep it) |

**Actions.**

| # | Action | API | Status |
|---|---|---|---|
| M1 | Back to the directory | UI | exists |
| M2 | Template (.xlsx) | `GET /v1/bulk-import/employees/template` | exists |
| M3 | Template (.csv) | none: the server only makes XLSX. Could be built in the browser from the same column list | missing (S) |
| M4 | "I have the file" | UI | exists |
| M5 | Pick or drop a file → check it | `POST /v1/bulk-import/employees/validate?companyId=` (multipart) | exists |
| M6 | "Mark fixed" per problem | means nothing on the server: commit checks the whole file again and refuses if any row fails | conflict (C13) |
| M7 | Back | UI | exists |
| M8 | Import N people | `POST /v1/bulk-import/employees/commit?companyId=`, with the seat check `assertCapacity(rows.size())` | exists |
| M9 | Back to the directory (when done) | UI | exists |
| M10 | Upload a different file / Import more / Retry (not in the design) | UI | exists (keep) |

**Big difference between the two ways of adding people.** Import creates people through `modules/hrms-employee/.../service/EmployeeService.createEmployee`, not through `WorkforceEmployeeService.create`. So an imported person gets:
- status **ACTIVE**, not PROBATION, and no default probation end
- a code of `EMP-{count+1}` from `EmployeeCodeGenerator`, ignoring the company's code settings (so it can collide with the settings counter)
- **no department**
- no reporting manager
- no default weekly offs or branch
- the old Kafka `employee.onboarded` event

The design's columns (code, branch, manager, PAN, UAN, bank, IFSC) point to moving import onto the same create path as Add employee (Q8).

### 2.4 Master overview: `PgOrg.dc.html`, mode `overview`

**Repo.**
- `/hrms/master` → `MasterContainer` (page `overview`) → `MasterDesign.OverviewPage` (lines 667–694). It exists, but shows **different content**:
  - hero "Master data", with Import data and Open Employee Master
  - 4 stats: People on roster, Contract workers, Locations, Needs attention
  - 4 group cards with link counts and "attention" flags: notice, licence expiring, departments without a head, unfilled designations, policy drafts, acknowledgements pending, statutory scheme off

**Data points.**

| # | Data point | Source | Status |
|---|---|---|---|
| O1 | "N people across C companies, B branches and D departments" (plus an empty-workspace version) | `empQ`, `useCompanies`, `branchesQ`, `depts` | exists |
| O2 | Stat Active | `empQ`, or `LiveHeadcount` | exists |
| O3 | Active note "Working today" | would need today's attendance (`GET /v1/attendance/dashboard`, `attendance.team.read`) or different copy | partial |
| O4 | Stat Probation | `empQ` | exists |
| O5 | Probation note "Reviews due in Oct" | `probationEndDate` / `GET /v1/probation/upcoming` | exists |
| O6 | Stat On notice | `empQ` | exists |
| O7 | Notice note "Leaving by Nov" (latest last working day) | `lastWorkingDay` | exists |
| O8 | Stat Exited this year | `empQ` | exists |
| O9 | Stat Suspended | `empQ` | exists |
| O10 | Suspended note "Pending inquiry" | nothing | missing (as D12) |
| O11 | Block: Companies count | `useCompanies` (`org.company.read`) | exists |
| O12 | Block: Branches count | `GET /v1/hrms/branches` (`org.company.read`) | exists |
| O13 | Block: Departments count ("With heads and cost centres") | `depts`. There is **no cost centre** field | exists (count). Copy depends on G5 |
| O14 | Block: Designations count | `desigs` | exists |
| O15 | Block: Grades count and "Pay bands L1–L6" | `GET /v1/hrms/grades` (any signed-in user); the range comes from grade codes | exists |
| O16 | Block: Agencies count | `GET /v1/hrms/contractors?includeArchived=true` (`hrms.contractor.read`) | exists |
| O17 | Policy acknowledgements: title of each live policy that must be acknowledged | `GET /v1/policy/policies?status=ACTIVE` (`hrms.policy.read` or `acknowledge.self`), where `acknowledgementRequired` | exists |
| O18 | … how many acknowledged | `PolicyResponse.acknowledgementCount` | exists |
| O19 | … "of N" and the bar % | **no audience figure from the server**. Today it's the headcount counted in the browser (`d.headcount`, which includes SUSPENDED), while the server's remind query uses `LIVE` = ACTIVE, PROBATION, NOTICE_PERIOD, ON_LEAVE (`PolicyNoticeService:53`) | partial |
| O20 | … "Remind N people" / "Everyone has acknowledged it" | worked out in the browser from O18 and O19 | partial (depends on O19) |
| O21 | Empty workspace: "Nothing here yet…" and "None yet" notes | browser | exists |

**Actions.**

| # | Action | API | Permission | Status |
|---|---|---|---|---|
| P1 | Stat → directory tab | `/hrms/employees?status=` | read | exists |
| P2 | Block → Companies & branches (Companies, Branches) or Organization setup tab | `/hrms/companies` is guarded by **`hrms.branch.read`**, which **no backend endpoint checks** (the backend uses `org.company.read`); ADMIN lacks it. Otherwise `/hrms/master/companies`. Departments and the rest go to `/hrms/master/*` | as the target page | exists (target to pick per permission) |
| P3 | Remind N people | `POST /v1/policy/policies/{id}/remind` → `{reminded, skippedRecentlyReminded, notAcknowledged}`. Skips anyone reminded in the last 24 hours (`act.remindPolicy`) | `hrms.policy.write` | exists |

**Gating by block.**
- Each stat, block and the policy card must show only with its own permission: `hrms.employee.read`, `org.company.read`, `hrms.department.read`, `hrms.designation.read`, `hrms.contractor.read`, and `hrms.policy.read`.
- Remind needs `hrms.policy.write`.
- Example: a DEPT_MANAGER reaches this page only through `hrms.contractor.read` (V065 grants it to SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER and OWNER). They should see the Agencies block and policies, and none of the people stats.

### 2.5 Organization setup: `PgOrg.dc.html`, mode `setup`

**What the design shows.**
- Header: the eyebrow "Workforce", the title, "Add {thing}".
- Tab card: title, count chip, a "Find a {thing}" search box.
- Table with row actions Edit and Remove.
- Empty and no-match states.
- The design gives no forms ("Opens a new department form"), so use the shared SidePanel.

**Repo.** The pages below are `MasterDesign` pages, each with its own `RecordForm` drawer. `/hrms/organization` opens the first Organization Setup page the person may open, which is **Companies** today.
- `DepartmentsPage` (427)
- `DesignationsPage` (462)
- `GradesPage` (490)
- `ContractorsPage` (317): the "Contractor Master" cards
- `CompaniesPage` (378) and `BranchesPage` (400)

Named hooks also exist in `modules/hrms/api/useOrg.ts`:
- `useDepartments`, `useCreateDepartment`, `useRenameDepartment`, `useUpdateDepartmentDetails`, `useSetDepartmentAppearance`, `useSetDepartmentHead`, `useArchiveDepartment`
- `useDesignations`, `useCreateDesignation`, `useUpdateDesignation`, `useArchiveDesignation`
- `useGrades`, `useCreateGrade`, `useUpdateGrade`, `useDeleteGrade`
- There is **no hook for agencies**: `MasterContainer` queries them inline under `['master','contractors',cid]`.

**Data points.**

| # | Data point | Source | Status |
|---|---|---|---|
| G1 | Count chip for the tab | browser | exists |
| G2 | Departments: name and initials tile | `GET /v1/hrms/departments?companyId=` (`hrms.department.read`). Returns **active rows only** (`findAllByCompanyIdAndActiveTrue…`) | exists |
| G3 | Departments: head | `departmentHeadEmployeeId` only; the name needs the directory (`hrms.employee.read`) | partial |
| G4 | Departments: people | `DepartmentResponse.employeeCount` is now **live** (`LiveHeadcount`, ACTIVE+PROBATION+NOTICE_PERIOD). The STATIC-UI note §6 that says these counts are "never maintained" is out of date. Today Master adds sub-teams into the parent's count | exists |
| G5 | Departments: **cost centre** | no column, no field, anywhere | **missing** (schema) |
| G6 | Departments: parent | `parentDepartmentId` | exists |
| G7 | Designations: name | `GET /v1/hrms/designations?companyId=` (`hrms.designation.read`), active only | exists |
| G8 | Designations: department | `departmentId` | exists |
| G9 | Designations: grade | `gradeId` / `grade` code (V143_22) | exists |
| G10 | Designations: people | `DesignationResponse.headcount` (live) | exists |
| G11 | Grades: "L1 · Associate" | `GET /v1/hrms/grades?companyId=` (any signed-in user), active only | exists |
| G12 | Grades: annual CTC band "₹3L – ₹6L" | `minCtcAnnual` / `maxCtcAnnual` / `bandVisible`. Hidden without `hrms.grade.band.read` (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD) | exists |
| G13 | Grades: designations count | designations counted by grade, in the browser | exists |
| G14 | Grades: people | sum of designation headcounts by grade (`GradeResponse` has no count) | exists (worked out) |
| G15 | Agencies: name | `GET /v1/hrms/contractors?companyId=&includeArchived=true` (`hrms.contractor.read`) | exists |
| G16 | Agencies: service | `serviceType` | exists |
| G17 | Agencies: contact person · email | `contactPersonName`, `contactEmail` | exists |
| G18 | Agencies: phone | `contactPhone` | exists |
| G19 | Agencies: deployed at | `siteBranchIds` → branch names (`org.company.read`) | exists |
| G20 | Agencies: licence valid till, with "renew soon" | `licenceValidUntil`. Master already flags anything within 30 days | exists |
| G21 | Empty and no-match states | browser | exists (copy) |

**Actions.**

| # | Action | API | Permission | Status |
|---|---|---|---|---|
| H1 | Add department | `POST /v1/hrms/departments` (an archived one with the same name comes back) | `hrms.department.write` | exists |
| H2 | Add designation | `POST /v1/hrms/designations` (also brings back an archived one) | `hrms.designation.write` | exists |
| H3 | Add grade | `POST /v1/hrms/grades` (also brings back an archived one; the band only with `hrms.grade.band.read`) | `hrms.grade.write` | exists |
| H4 | Add agency | `POST /v1/hrms/contractors` | `hrms.contractor.write` | exists |
| H5 | Edit (each tab) | Departments: `PATCH /departments/{id}/name`, `/details`, `/appearance`, `/head`, `/parent`, and `PUT /departments/{id}/branches`. Designations: `PUT /designations/{id}`. Grades: `PUT /grades/{id}`. Agencies: `PUT /contractors/{id}` | the matching write permission | exists |
| H6 | Remove (each tab) | `DELETE` = **archive** (soft) for departments, designations, grades and agencies. For agencies this is "End contract", which `POST /contractors/{id}/restore` undoes | the matching write permission | exists (call it Deactivate / End contract) |
| H7 | Search in the tab | browser | none | exists |
| H8 | Tab switch (top bar) | routes `/hrms/master/{departments,designations,grades,contractors}` | the tab's read rule | exists |

**What today's pages do that the design's plain tables leave out** (keep them in row menus and panels; C15):
- **Departments**: the sub-team tree with expand and collapse, the icon and colour, the branches a department works in, the "Assign head" dialog, the "no head" warning, and adding a sub-team.
- **Designations**: code, filters by department and grade, sorting and paging, and refusing to deactivate a title people still hold.
- **Grades**: band bars and overlap, and the ladder.
- **Agencies**: stats (agencies, contract workers, licences expiring), the share of the contract workforce, **Renew licence**, **Reactivate** and **Export** (CSV).
- **Companies**, **Branches** (with `?archived=1` for inactive ones) and **Classification Rules** have no place in the design's Organization setup (Q10).

**Permissions.**
- The page today needs a **write** permission (ORG_SETUP), because every employee holds `hrms.department.read`.
- Agencies needs only `hrms.contractor.read`, which DEPT_MANAGER holds. So in the redesign the page gate must be ORG_SETUP **or** `hrms.contractor.read`, with each tab gated on its own read.
- `hrms.branch.write` and `hrms.branch.read` are used only by the frontend. The backend's branch endpoints check `org.company.read` and `org.company.write`.

### 2.6 Rules & policies: `PgSetup.dc.html`, page `m-rules`

**What the design shows.** The PgSetup frame: eyebrow "Workforce", title, sub-line, and a main button per tab. Its sub-views open **in the page** with a back link:
- `policy`: read a policy
- `shift`: add or edit a shift rule
- `pub`: publish or edit a policy

The README says pop-ups are square side panels, so the lead should choose between in-page and side panel.

**Repo.**
- Master `ShiftsPage` (515) and `ShiftForm` → `/hrms/master/shift-rules`.
- Master `LeavesPage` (547) and `LeaveForm` → `/hrms/master/leave-rules`.
- Master `PoliciesPage` (577) and `PolicyForm` → `/hrms/policies` for authors.
- For everyone else `modules/hrms/Policies.tsx` (module kit) already has exactly the design's 4 views, via `?view=`: `shifts`, `leaves`, `documents` and `manage`.
- Hooks:
  - `useShiftPolicies`, `useCreateShiftPolicy`, `useUpdateShiftPolicy`, `useDeleteShiftPolicy` (`/v1/shifts`)
  - `useLeaveTypes` (`/v1/leave/types`)
  - `usePolicies`, `usePolicy`, `useCreatePolicy`, `useUpdatePolicy`, `useArchivePolicy`, `useUnarchivePolicy`, `useMyAcknowledgements`, `useAcknowledgePolicy`, `usePolicyAcknowledgements` (`/v1/policy/*`)

**Data points.**

| # | Data point | Source | Status |
|---|---|---|---|
| R1 | Policies tab: "Active policies" | `usePolicies(page,'ACTIVE')` → `GET /v1/policy/policies` `totalElements` (`hasAnyAuthority('hrms.policy.read','hrms.policy.acknowledge.self')`) | exists |
| R2 | "You’ve acknowledged" | `useMyAcknowledgements()` → `GET /v1/policy/my-acknowledgements` (`hrms.policy.acknowledge.self`). Counted **per version** | exists |
| R3 | "Still to acknowledge" | the same | exists |
| R4 | Current versions: policy, category, version, effective date | `PolicyResponse` | exists |
| R5 | Status: Acknowledged / To acknowledge / For reading | `acknowledgementRequired` + R2 | exists |
| R6 | Reading view: summary | `content` | exists |
| R7 | Reading view: "Owner" | `hr_policies.created_by` exists (V075) but isn't in `PolicyResponse` | partial |
| R8 | Reading view: "Applies to: Everyone in {company}" | `companyId` → company name | exists |
| R9 | Shift rules: shift, type, timing, grace, hours per day, overtime | `GET /v1/shifts?companyId=` (`attendance.checkin.self`). This is `attendance.shift_policies`, the table attendance really reads. Don't use `org.shifts` (`/v1/hrms/shifts`), which is legacy | exists |
| R10 | Leave rules: leave type, entitlement, paid, carry forward | `GET /v1/leave/types?companyId=` (any signed-in user) | exists |
| R11 | Manage: All / Active / Draft / Archived | 3 calls, `?status=ACTIVE`, `DRAFT` and `ARCHIVED` (the last two need `hrms.policy.write`, or the server refuses) | exists |
| R12 | Manage: policy, category, version | `PolicyResponse` | exists |
| R13 | Manage: acknowledged "231 of 249" | `acknowledgementCount` plus the audience from the browser (same problem as O19) | partial |
| R14 | Manage: status | `status` | exists |

**Actions.**

| # | Action | API | Permission | Status |
|---|---|---|---|---|
| S1 | Read a policy | UI (`GET /v1/policy/policies/{id}` if needed) | read or acknowledge.self | exists |
| S2 | Acknowledge | `POST /v1/policy/policies/{id}/acknowledge` | `hrms.policy.acknowledge.self` | exists |
| S3 | Add shift rule | `POST /v1/shifts?companyId=` | `attendance.workforce.admin` | exists |
| S4 | Edit shift rule | `PUT /v1/shifts/{id}` | `attendance.workforce.admin` | exists |
| S5 | Delete shift rule | `DELETE /v1/shifts/{id}` (soft). **Known bug:** `GET /v1/shifts` puts the four default shifts back on every read, so deleting one of them is undone | `attendance.workforce.admin` | partial |
| S6 | Open leave types | `/hrms/leave?tab=types` (Leave page; editing needs `leave.type.write`) | page rule | exists |
| S7 | Publish policy | `POST /v1/policy/policies?companyId=` (status DRAFT or ACTIVE). The emails for "notify on publish" are sent by the server | `hrms.policy.write` | exists |
| S8 | Edit policy | `PUT /v1/policy/policies/{id}` | `hrms.policy.write` | exists |
| S9 | Archive | `POST /v1/policy/policies/{id}/archive` | `hrms.policy.write` | exists |
| S10 | Publish a draft | `POST /v1/policy/policies/{id}/publish` | `hrms.policy.write` | exists |
| S11 | Restore | `POST /v1/policy/policies/{id}/unarchive` | `hrms.policy.write` | exists |
| S12 | Tab switch | routes and `?view=` | per tab | exists |

**What today's pages do that the design leaves out** (keep them):
- **Policies**: Remind (P3), Start new version, Discard draft (`DELETE /v1/policy/policies/{id}`), the "Require acknowledgement", "automatic reminder after N days" and "Email everyone when published" settings, and the category filter and search.
- **Shifts**: code, core hours, weekly offs per shift, Duplicate, people per shift, and Activate / Deactivate.
- **Leave rules**: full add and edit in Master (see C17).

**Tab gates today** (`Policies.tsx` `ALL_TABS`):
- `shifts` requires **`ATTENDANCE_REGULARIZATION_APPROVE`**. **This is a bug**: the server checks `attendance.workforce.admin`, so DEPT_MANAGER sees a Shift Rules tab it can't save.
- `leaves` requires `LEAVE_TYPE_WRITE`.
- `documents` requires `['hrms.policy.read','hrms.policy.acknowledge.self']`.
- `manage` requires `hrms.policy.write`.

In the redesign:
- Shift rules → `attendance.workforce.admin`.
- Leave rules → `leave.type.write` (reading is open).
- Policies → `hrms.policy.read` or `acknowledge.self`.
- Manage policies → `hrms.policy.write`. Drafts and archived need write on the server.

**Bug:** authors can't acknowledge their own policies. Anyone holding both `hrms.policy.write` and `hrms.policy.read` is sent to Master Policy Documents by `PoliciesRoute`, so HR admins have no web page to acknowledge their own policies. The design's Policies tab fixes this.

---

## 3. Gaps: backend work needed

| # | Gap | Backend work | Schema change | Table mapped by JPA | Size |
|---|---|---|---|---|---|
| 1 | Directory and overview stats from the server: probation and suspended counts; joined and left this month; notice started in the last 7 days; probation reviews due next month; exits this year; attrition %; a 7-point series | New `GET /v1/hrms/employees/stats?companyId=` (`hrms.employee.read`, JDBC over `hrms.employees` + `hrms.employee_status_history`), or extend `/employees/counts` in a backwards-compatible way. Can be done in the browser for up to 5,000 people meanwhile | no | n/a | M |
| 2 | "Suspended · since {date}" (the design's "pending inquiry") | Read the SUSPENDED start from `employee_status_history`. A real suspension record with reason and inquiry is a new table and a suspend/reinstate action on the profile (Q11) | no (since); yes for reasons (new table `hrms.employee_suspensions`) | no | S / M |
| 3 | "Paid through payroll" filter | Decide the source (Q3). If it's the employment-type flag: none. If it's "has a salary structure": add an `onPayroll` flag to a lookup endpoint (`hrms.employee.read` + payroll read) | no | n/a | S |
| 4 | Directory search word by word (name, code, email, department, designation, branch), as the global search already does | Browser filter, or extend `WorkforceFilter.search` | no | n/a | S |
| 5 | Company filter plus `?companyId=` / `?co=`, and `?add=1` | frontend only | no | n/a | S |
| 6 | Bulk Assign shift | Optional `POST /v1/shifts/employees/assign` `{employeeIds, shiftPolicyId, effectiveFrom}` (`attendance.workforce.admin`), or a loop in the browser | no | n/a | S |
| 7 | Bulk Send letter | frontend: open `DistributionWizard` with `employeeIds` filled in | no | n/a | S |
| 8 | **Save draft** for Add employee, and a place to find drafts | New table `hrms.employee_drafts` (id, tenant_id, company_id, created_by, payload jsonb, created_at, updated_at; RLS forced). `GET/POST/PUT/DELETE /v1/hrms/employee-drafts` (`hrms.employee.write`, tenant-scoped, JDBC only). The UI hides drafts when the table is absent. New permission: none | **yes (new table)** | no | M |
| 9 | Start onboarding automatically on Add employee and Import | Pull `ConversionOnboardingStarter.pick()` out into a shared service and call it after `WorkforceEmployeeService.create` and after each import row. Return the result so the UI can say so | no | n/a | S–M |
| 10 | Tell the reporting manager when someone is added | New notification event (notiftemplate registry, built-in wording, in-app and email). Existing notification tables | no (to confirm) | n/a | M |
| 11 | Per-person "Anywhere (no geofence)" | New table `hrms.employee_punch_rules` (employee_id, allow_anywhere). `CanonicalAttendanceService` and `AssistedPunchService` must honour it. Create and update write it through JDBC | **yes (new table)** | no | M |
| 12 | Weekly off patterns such as "2nd and 4th Saturday" | New rule store (e.g. `hrms.employee_weekly_off_rules`, and a company-level one). Every day-type calculation must honour it (attendance calendar, daily logs, muster roll, payroll working days, leave day counts). Don't touch the JPA-mapped `hrms.employees.weekly_off_days` | **yes (new table)** | no | L |
| 13 | Salary on Add employee → first pay run | Either create a draft salary structure from the monthly salary (`/v1/payroll/structures`, payroll structure write permission), or change the copy (Q4) | no | n/a | M |
| 14 | Bank name list | Reference list, or free text with suggestions | no | n/a | S |
| 15 | Report To picker | frontend only (`reportingManagerId` is already accepted) | no | n/a | S |
| 16 | **Import on the Add employee path, with the design's columns** | Create each row through `WorkforceEmployeeService.create`. Map department and designation by name (**fixes the dropped department**), branch by name or code, reporting manager by code or email, and add employee_code, pan, uan, esi, bank_account, ifsc and bank_name. Return structured `problems[{row, column, message}]` plus `warnings[]` (keeping the flat `errors` for older callers). Add a CSV template and a `GET /v1/bulk-import/employees/columns` endpoint so the chips can't drift. Start onboarding (#9) | no | n/a | M–L |
| 17 | Policy audience and pending counts, and the owner's name | Add `audienceCount`, `pendingCount` and `ownerName` to `PolicyResponse` (filled in at the API layer; the count uses `PolicyNoticeService.LIVE`) | no | n/a | S |
| 18 | Department **cost centre** | New table `hrms.department_cost_centres` (department_id PK, tenant_id, cost_centre; RLS). Read and write through JDBC; include it in `DepartmentResponse` through a JDBC lookup. Hide the column if the table is absent. `hrms.departments` **is** JPA-mapped (`Department.java`), so don't add a mapped column | **yes (new table)** | no (side table) | S–M |
| 19 | Department head's name for viewers without the directory | Add `headName` to `DepartmentResponse` (a join) | no | n/a | S |
| 20 | Default shifts come back after being deleted | `GET /v1/shifts` should create the defaults only when a company has none | no | n/a | S |
| 21 | Wrong shift permission in the frontend (`Policies.tsx` tab, `EmployeeForm.tsx:276`) | frontend: use `attendance.workforce.admin` | no | n/a | S |
| 22 | Leave → Leave types lacks accrual and encashment (needed if Master Leave rules becomes read-only as designed) | frontend only. The server already protects these fields on a full-replace PUT (`LeaveTypeService.applyAccrualAndEncashment`) | no | n/a | S–M |
| 23 | Authors' own Policies view at `/hrms/policies?view=documents` | frontend (`PoliciesRoute`) | no | n/a | S |

Every new table needs a migration that production applies **by hand**. Until it's applied, the feature must show an empty state or hide, only in its own block. No new permission is needed for gaps 1–23. If the lead adds one (e.g. `hrms.employee.draft`), it must be granted to OWNER and SUPER_ADMIN in the same migration (`OwnerPermissionInvariantCheck`).

---

## 4. Conflicts with today's behaviour and earlier client decisions

| # | Conflict | Proposal |
|---|---|---|
| C1 | Directory: a row click opens the **full profile**. Today it opens the quick drawer, and the row menu (View profile, Edit details, **Start exit**) and "Full record" are gone. `live-w3-r1` uses More actions → Start exit | Keep a trailing ⋮ menu (View profile, Edit details, Start exit) and let the row open the profile |
| C2 | Directory: no Status dropdown, **no Milestone filter**, no company filter, no pager | Keep the milestone filter: the dashboard's "View all" and `milestoneRange.ts` use `?filter=&from=&to=`. Add a company filter when there's more than one company. Keep paging |
| C3 | Directory: the default tab **Active** hides exited people. Today the default shows everyone. The dashboard's "Active employees" tile links to `?status=ACTIVE` and says "Excludes exited and on-notice". `live-directory-export` expects the full count | Q1 |
| C4 | Directory search: the design has no box in the card; the query comes from the shell's page filter. Today there's an inline box pre-filled from `?q=`, which the global search relies on | Keep `?q=` as the source of truth and show the shell's clearable chip. The lead decides whether to keep an inline box too |
| C5 | Bulk **Change status** exists today but isn't in the design | Keep it as a fourth bulk action |
| C6 | Add employee: the design has no **Branch** (required today), **Staffing agency** or **Access** step, no invitation choice, no inline "+ Add" and no unsaved-changes guard | Keep them all. Access becomes step 3 of 4 (Basic, Financial, Access, Review), shown only with the rights |
| C7 | Required fields differ. **Design:** last name, work email, designation, department, date of joining, type, salary frequency, **monthly salary, PAN, bank account, IFSC**. **Master drawer:** first, last, email, company, branch, department, designation, date of joining. **Old wizard (mobile rules):** first, email, **phone**, designation, department, code, date of joining, salary frequency, with every ID and bank field optional | Q4. "Keep every validation rule" argues against the design's stricter set |
| C8 | Future joining date: the design defaults to one and shows "Joins"; the Master drawer allows it; the old wizard and mobile block it | Q4 |
| C9 | Designation: the design uses a text box; today it's a list with free text as the fallback | Keep the list |
| C10 | Weekly offs: design presets (including alternating Saturdays) against day chips | Q6 |
| C11 | "Punch Location (Zone)": decision D3 retired the zones page, so punch zones live on branches, but per-person zones still work. The design lists branches with their radius, plus "Anywhere" | Map it to the branch's check-in area plus an optional per-person zone. "Anywhere" is Q6 |
| C12 | "What happens next" and the import result promise an onboarding run and a manager notice that don't happen today | Build them (gaps 9 and 10) or change the words (Q7) |
| C13 | Import: the design's columns differ from the backend. **"Mark fixed"** conflicts with the all-or-nothing commit. There's no company picker | Replace "Mark fixed" with "Upload the fixed file". Keep the company picker. Expand the columns (Q8) |
| C14 | Master overview drops the "Needs attention" flags (notice, licence expiring, departments without a head, unfilled titles, drafts, pending acknowledgements, statutory off), the Payroll Configuration group, and Import data / Open Employee Master | Fold the flags into the block rows as small warning notes ("2 without a head", "licence ends in 12 days") |
| C15 | Organization setup: Companies and Branches move to Companies & branches; Classification Rules has no place; Contractor Master's cards become a plain Agencies table; the department tree, icons, colours and branches aren't shown | Keep every function in row menus and side panels. Keep every URL (Q10) |
| C16 | `/hrms/organization` opens Companies today; in the design it opens Departments | Follow the design, and keep the Companies URLs |
| C17 | Leave rules are read-only in the design, with "Open leave types" → Leave. Master edits them fully today. This is the known "editable in two places" duplication (`DEPLOY_2026-09-26_WAVE3.md` §6), but Leave → Leave types can't edit accrual or encashment | Q9 |
| C18 | The design's Policies tab for authors: today `PoliciesRoute` sends policy authors to Master, so they can't acknowledge | Fix it (gap 23) |
| C19 | **Settings stay in their own sections** (the 26 Sep hub was undone): Master → Rules & Policies and Payroll Configuration must stay under this group. The design's Workforce module has no Payroll Configuration page | Keep Payroll Configuration (`/hrms/payroll/components`, `/hrms/master/statutory`) as a 5th Workforce page, or agree a move with the Payroll audit (Q10) |
| C20 | Rail label "Master" becomes "Workforce" (the design's grouping, decision 6). `railLit.ts` stores the clicked rail key (`ut:rail-via`); `live-rail-highlight` expects "Master" lit on `/hrms/master/shift-rules` and `/hrms/policies` | Rename the label. Keep the key `master` if possible, or update the test |
| C21 | Calendar: the prototype uses native date inputs. The shared calendar decision (`src/shared/components/calendar`, `DateField`) covers date of birth, date of joining, last working day, policy effective date and licence date | Always use `DateField` |
| C22 | The Add employee **Preview card is a dark-green filled block**, which breaks the README rule "No dark-green filled content blocks in pages". The bulk-selection bar is also solid green | Ask the lead: keep it as a small accent or make it a white card |
| C23 | Earlier client decisions: "My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN" and the greeting rule don't apply here (no greeting, no My Attendance). "Companies restore / Inactive view" applies if `/hrms/master/companies` and `/branches` stay (Branches' `?archived=1`) | Keep those URLs working, or route them to the Companies & branches page, which has the Inactive view and company restore |

---

## 5. Shared components these screens need

**From the README list:**
- `PageHeader`: eyebrow, title, sub-line, actions.
- `PillTabs`: directory statuses, organization tabs, rules tabs.
- `SearchPill`, including the page-filter chip for `?q=`.
- `StatCard`, as in `UtStat`: icon, label, value, delta with trend and mood, note, sparkline, tone (brand, gold, red, gray), active ring, click.
- `Card` / `Section`.
- `ListRow`: overview blocks, policy acknowledgement rows.
- `StatusPill`: ok, mint, warn, bad, gray, info.
- `SegmentedControl`: Table / Cards, the payroll filter, Gender / Type / Frequency segments, policy status.
- `FilterPills` / `Dropdown` with search: department, branch, type, company, milestone.
- `Meter` / `ProgressBar`: acknowledgement bars, import progress.
- `Avatar`: 36 px row, 52 px card, 32 px rounded tile.
- `EmptyState`, `Skeleton`, `Toast`.
- `Popover` / `Menu`: row menus, bulk menus.
- `SidePanel`: square, with steps and a sticky footer, for the department, designation, grade, agency, shift and policy forms.
- `Dialog`: confirm deactivate, end contract, start exit.
- `FormField`: input, select, textarea, toggle/switch, and dates through `DateField`.

**Page-specific pieces:**
- **Data table** with a selection column, a tri-state "select all", a floating bulk bar, sort and pager. `TableCard` in `shared/components/hr.tsx` is a start.
- **Person card grid**, with a hover tilt.
- Add employee's **horizontal pill stepper** and **Preview card**.
- Import's **3-card stepper**, **drop zone** and **problems table**.
- The **Review summary block**, with masked values and an Edit per section.
- The **Access picker** (`AccessPicker.tsx`, restyled only).

**Existing kits to extend rather than duplicate:**
- `design/module/ModuleKit.tsx`: `ModulePage`, `Views`, `StatRow`, `State`, `Panel`, `RowList`, `Note`, `Facts`, `useDesignToast`.
- `shared/components/hr.tsx`: `HrStatCard`, `HrStatusPill`, `HrButton`, `TableCard`, `FilterBar`, `HrAvatar`, `HrTabs`, `HrSelect`, `HrDrawer`.
- `shared/components/calendar`: `DateField`.

---

## 6. Risks

**Live tests that check today's markup** (`apps/platform/e2e/recovery`):

| Test | What it depends on |
|---|---|
| `live-design-master.mjs` | Master markup: nav "Master sections"; headings (Employee Master, Contractor Master, Classification Rules, Grades & Bands, Policy Documents…); `#utm-portal .drawer`, `.toast`, `table.t`, `.tbar .meta`, `.ttab`, `.ccard`, `.utm`; the placeholder "Search name, code, email or role…". Some checks already fail on `main` |
| `live-w3-access.mjs` | the Access section inside the Master drawer: `.utm .hero-act`, `[data-access-step]`, `.ddb`, `#utm-portal .pop .opt`, the toast "… Access added", the 390-px layout |
| `live-w3-r1.mjs` | the "Add employee" dialog, "More actions" → Start exit, and the Add company / Add agency drawers |
| `live-w3-search.mjs` | the directory box pre-filled from `?q=` |
| `live-w3-milestones.mjs` | the "Milestone:" filter text and `?filter=&from=&to=` |
| `live-directory-export.mjs` | an Export button named exactly "Export", the export count equal to the whole directory, and the toast |
| `live-directory-search.mjs` | already crashes on `main` |
| `live-settings-restored.mjs` | requires an **exact match** with commit `5f45946` for `/hrms/master*`, `/hrms/policies` and `/hrms/payroll/components`, so a redesign fails it by construction. It must be re-based or retired |
| `live-rail-highlight.mjs` | "Master" lit, and its `OWN_BAR` pattern |
| `live-design-hrsetup.mjs` | the employee's `/hrms/policies`: h1 "Policies", "Still to acknowledge", `button[aria-expanded]`, "Active policies" |
| `live-design-last.mjs` | h1 "Import employees" |
| `live-browser.mjs` | goes through every `/hrms` route |

**Other tests:**
- The older Playwright specs `e2e/tests/{hr-manager,super-admin}/02-employees.spec.ts` and `03-organization.spec.ts` target the old UI and are probably stale already.
- Unit tests:
  - `src/shared/navigation/pageRegistry.test.ts`: its tab-parameter map; directory access by role.
  - `src/design/dc/milestoneRange.test.ts`: the `/hrms/employees?filter=` paths.
  - `src/modules/hrms/api/useBulkImport.test.ts`: `parseErrors` / `countValidRows`, if the import result changes.
  - `src/shared/search/search.test.ts`: the `add-employee` action.

**Generated code.**
- `MasterDesign.tsx` and `master.css` are rebuilt by `master-build.mjs`. Hand edits are lost, and the patches in `master-patches.mjs` fail if their targets change.
- If the new pages replace Master's, the Master pages other audits own must move or stay working: Salary components, Statutory, Companies, Branches and Classifications.
- `masterData.ts` and `masterSync.ts` hold months of careful save logic (diffs, change orders, error messages). Reuse or port them.

**Data size and access.**
- The directory loads everyone in the browser, at most 25 × 200 = 5,000 people. A bigger workspace is cut off silently, and the stats and filters run over that list.
- Branch names need `org.company.read`, so a custom role without it sees "—".

**Two shift stores.**
- Only `attendance.shift_policies` (`/v1/shifts`) drives attendance.
- `org.shifts` (`/v1/hrms/shifts`, `hrms.shift.write`) is legacy. Don't use `useOrg`'s shift hooks.

**Changing import changes its results** (Q8): people would get probation status, codes in the company format, and departments.

**Personal data in drafts** (gap 8): PAN, Aadhaar and bank details. `hrms.employees` stores them in plain text today.

**Pages shared with the self-service audit.**
- `/hrms/policies` is also the employee's policy page. The design moves employees' policies to My work → Documents.
- The route decision must not break `live-design-hrsetup`'s employee checks.

**Dark mode and font.**
- Master's CSS (`.utm`) and `MasterDesign`'s inline tones are light-only.
- Every tone used here needs a dark token.
- The weight must be 600 at most.

---

## 7. Open questions

Each has a recommended default, so the lead can go ahead.

1. **Q1. What the "Active" tab means.**
   - The prototype shows everyone employed (Active + Probation + Notice). That matches the server's `LiveHeadcount`.
   - The dashboard's "Active employees" tile links to `?status=ACTIVE` and says it excludes people on notice.
   - *Default:* the Active tab means employed. `?status=ACTIVE` keeps showing ACTIVE only, as a filtered view.
2. **Q2. Keep what the design dropped?**
   - The row menu (View, Edit details, Start exit), bulk Change status, the milestone filter and the pager.
   - *Default:* keep all.
3. **Q3. What decides "Paid through payroll"?**
   - Option one: the employment type's flag, which is what Classification Rules shows but payroll never reads.
   - Option two: whether the person has a salary structure.
   - *Default:* the employment-type flag, labelled as it is on Classification Rules.
4. **Q4. Add employee rules.**
   - The design's stricter required fields (monthly salary, PAN, bank account, IFSC), a future joining date, and "Used for the first pay run".
   - *Default:* keep today's optional rules. Allow a future joining date, as the Master drawer does. Change the salary copy unless a salary structure is created.
5. **Q5. Save draft.**
   - Build the new drafts table? Where do drafts appear? The design says "Drafts in the directory" but has no Drafts tab.
   - Should drafts keep PAN, Aadhaar and bank details?
   - *Default:* build it; show a "Drafts (n)" chip on the directory; leave ID and bank fields out of drafts.
6. **Q6. New attendance rules.**
   - "2nd and 4th Saturday" weekly offs (L) and per-person "Anywhere (no geofence)" (M).
   - *Default:* build "Anywhere". Ask the user about alternating Saturdays, because it touches attendance and payroll everywhere.
7. **Q7. Onboarding and manager notice.**
   - Start onboarding automatically (by template match) and notify the manager on Add and Import, or change the copy?
   - *Default:* build both.
8. **Q8. Import on the Add employee path.**
   - Move import onto the same create path, with the design's columns.
   - Imported people then get probation status, codes in the company format, and departments.
   - *Default:* yes.
9. **Q9. Leave rules read-only?**
   - Make Master Leave rules read-only with "Open leave types", after adding accrual and encashment to Leave → Leave types?
   - *Default:* yes. This ends the duplication.
10. **Q10. Pages with no design home.**
    - Companies and Branches under Master, Classification Rules, and Payroll Configuration (Salary components, Statutory).
    - *Default:* keep every URL. Companies and Branches go to the Companies & branches page. Classifications becomes a 5th Organization-setup tab. Payroll Configuration stays a Workforce page, per the "settings stay in their sections" decision.
11. **Q11. Suspended.**
    - Show "since {date}" from the status history, or build suspension records with a reason, and a Suspend / Reinstate action on the profile?
    - *Default:* "since {date}" now; suspension records with the profile work.
12. **Q12. Department "Cost centre".**
    - Add the field (new table), or show the department code in that column?
    - *Default:* add the field.
