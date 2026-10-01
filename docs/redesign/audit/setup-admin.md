# Phase 0 audit: Compliance, HR setup, workspace settings, users & access, roles, audit logs, workspace page, generic page

Area owner: setup-admin agent. Read-only audit of `main` at `e32a4dc6` (C:\REACT\unifiedtree-saas).
Design source: `C:\REACT\ut-wt\design-ref\design_handoff_hrms_redesign\prototype\PgSetup.dc.html`, `PgAdmin.dc.html`, `PgWorkspace.dc.html`, `PgGeneric.dc.html` (+ `hrms-core.js`, `UtSections/UtSection.dc.html`, `UtMore.dc.html`, `HrmsPlatform.dc.html`).
Live checks: GET calls against `http://127.0.0.1:8080/api` as owner@, hrm@ and reader@; read-only SQL on `unifiedtree_recovery`.

Status words used below:
- **exists**: the backend already returns it (hook and endpoint named) and only the UI changes.
- **exists (unused)**: the API returns it but today's page doesn't show it.
- **partial**: some of it exists; what is missing is named.
- **missing**: no endpoint or no data at all.
- **static copy**: explanatory text in the design, not data (allowed).

---

## 0. Summary

- **Almost everything in this area is already built end to end.** PgSetup and PgAdmin were drawn from today's pages: tab names, subtitles, empty-state copy and form fields match `Compliance.tsx`, `Policies.tsx`, `HrConfigurationPage.tsx`, `NotificationTemplates.tsx`, `Integrations.tsx`, `pages/Settings.tsx`, `Users.tsx`, `Roles.tsx` and `AuditLogs.tsx` almost word for word. Most work is restyling onto the shared components.
- **Real backend gaps are mostly small (S):**
  - summary counts that are page-scoped today (compliance, templates, integrations, policies)
  - status and channel filters on list endpoints
  - a filed date on "Mark filed"
  - role counts and role-grant metadata
  - the probation reminder recipients
  - the password "last changed" date
  - sign-in events in the audit log
  - a headcount trend for headcount-only viewers
- **Four are bigger, and each needs a decision:**
  - POSH department (new DB column) and a new "Closed" status (behaviour change)
  - billing invoices from Razorpay
  - real workspace integrations (Slack, Google Workspace, Microsoft Teams: OAuth, secrets, new table)
  - IP-to-city for sessions
- **PgWorkspace** is a leftover "My Workspace" overview for the prototype's `me` module. The prototype never reaches it:
  - no role's rail groups include `me`
  - More → "My workspace" opens the Dashboard for the admin persona and Home (`EmpHome`) for everyone else
  - the README's screen table doesn't list it, and maps `/me` (`ess/EssDashboard.tsx`) to **EmpHome**

  Recommendation: don't build PgWorkspace as its own page; `/me` takes the EmpHome design (self-service audit). Its blocks and their data sources are still mapped below (§11) because EmpHome reuses most of them.
- **PgGeneric** is the prototype's "Page frame": a skeleton with a header, 4 stat-card placeholders and a table card, captioned "This page isn't designed yet". The prototype shows it only for pages with no designed view (in practice the "soon" business apps: CRM, Accounts, Projects, Inventory, Purchase).
  - It is a **layout contract, not a product page**. Never ship its skeleton or its caption.
  - Use it as the template for any page without its own design.
  - Keep today's `ComingSoon` (admins only, client rule of 25 Sep) for unbuilt apps, restyled with `EmptyState`.
- **Settings placement:** the design keeps every setting in its own section, which matches the 26 Sep decision:
  - HR setup (HR configuration, Notification templates, Integrations) is a rail module
  - Rules & policies is a page of Workforce (Master)
  - payroll settings are under Payroll
  - document types are a tab of workspace Settings
  - Users, Roles and Audit are pages of the Settings module

  Four real differences:
  1. **The entry points change.** The design has no header gear and no profile menu; Settings opens only from More → "Preferences". The 26 Sep undo explicitly kept "the header gear and the profile menu as before".
  2. **The Settings tab row changes.** The design has 8 tabs (Profile, Branding, Security, Notifications, Billing & plan, Integrations, Document types, Danger zone). Users & access, Roles & permissions and Audit logs become separate pages of the module. Today's tab row has 10 items (Profile→`/profile`, …, Users, Roles, Audit, Danger zone) and no Document types.
  3. **Payroll configuration has no home** in the design's Workforce module (salary components `/hrms/payroll/components`, statutory `/hrms/master/statutory`). 26 Sep said Master keeps it. This is a cross-area item.
  4. **Settings pages would light "More"** in the rail (`moreOn … || mk0 === 'settings'`) instead of the header gear.

---

## 1. Map: design → today

| Design (hrms-core `M`) | Pages / tabs in design | Route(s) today | File(s) today | Page exists? |
|---|---|---|---|---|
| `compliance` → `cp-stat` Statutory compliance | Compliance calendar · Statutory filings · POSH register · Inspector access | `/hrms/compliance` `?view=calendar\|filings\|posh\|inspector`; public `/inspection` | `modules/hrms/Compliance.tsx`, `compliance/FilingCalendar.tsx`, `compliance/InspectorSessions.tsx`, `compliance/InspectionFiles.tsx`, `compliance/InspectorView.tsx`, `api/useCompliance.ts` | Yes |
| `compliance` → `cp-muster` Muster roll | (designed in PgTime; not this audit) | `/hrms/muster-roll` | `attendance/MusterRoll.tsx` | Yes (Time audit) |
| `workforce` → `m-rules` Rules & policies | Policies · Shift rules · Leave rules · Manage policies | `/hrms/policies` (`?view=documents\|shifts\|leaves\|manage` for non-admins), `/hrms/master/shift-rules`, `/hrms/master/leave-rules` | `modules/hrms/Policies.tsx` (non-admins), `master/MasterContainer.tsx` + generated `design/master/MasterDesign.tsx` (admins: `PoliciesRoute` in App.tsx), `api/usePolicy.ts`, `api/useShiftPolicies.ts`, `api/useLeave.ts` | Yes (two versions) |
| `hrsetup` → `hs-config` HR configuration | one page, 8 form cards | `/hrms/settings`, `/hrms/settings/work-time` | `modules/hrms/settings/HrConfigurationPage.tsx`, `design/settings/SettingsKit.tsx`, `api/useSettings.ts`, `api/useProbation.ts`, `api/useAttendanceReview.ts` | Yes |
| `hrsetup` → `hs-notif` Notification templates | one page | `/hrms/notification-templates` | `modules/hrms/NotificationTemplates.tsx`, `api/useNotificationTemplate.ts` | Yes |
| `hrsetup` → `hs-int` Integrations | one page | `/hrms/integrations` | `modules/hrms/Integrations.tsx`, `api/useIntegration.ts` | Yes |
| `reports` → `r-wfa` Workforce analytics | Headcount · Attrition · Diversity | `/hrms/workforce-analytics` (no tabs today) | `modules/hrms/analytics/WorkforceAnalytics.tsx`, generated `design/dc/WorkforceAnalytics(.view).tsx`, `api/useReports.ts` | Yes (one page, no tabs) |
| `settings` → `s-config` Settings | Profile · Branding · Security · Notifications · Billing & plan · Integrations · Document types · Danger zone | `/settings` (= Profile), `/settings/:tab`, `/settings/billing`, `/settings/security`, `/settings/danger` | `pages/Settings.tsx`, `SettingsWorkspaceProfile.tsx`, `SettingsSecurity.tsx`, `SettingsDangerZone.tsx`, `SettingsDocumentTypes.tsx`, `NotificationChoices.tsx`, `branding/BrandingTab.tsx`, `workspaceSettingsApi.ts` | Yes |
| `settings` → `s-users` Users & access | one page | `/users` | `pages/Users.tsx`, `users/InviteWorkspaceUserModal.tsx`, `users/ManageAccessDrawer.tsx`, `users/UserPermissionOverrides.tsx`, `modules/rbac/api/useWorkspaceAccess.ts` | Yes |
| `settings` → `s-roles` Roles & permissions | Roles · Who has which role · Permission catalogue | `/roles` `?view=roles\|assignments\|catalogue` | `pages/Roles.tsx`, `modules/rbac/api/useRbac.ts` | Yes |
| `settings` → `s-audit` Audit logs | one page | `/audit-logs` | `pages/AuditLogs.tsx`, `modules/hrms/api/useAudit.ts` | Yes |
| `me` → `me` My Workspace (PgWorkspace) | one page (unreachable in the prototype) | `/me`, `/hrms/ess` | `modules/hrms/ess/EssDashboard.tsx`, `ess/AttendanceHistory.tsx`, `ess/TimeEntries.tsx` | Yes (to become EmpHome) |
| any undesigned page (PgGeneric) | none | `ComingSoonRoute` for `/crm`, `/accounts/*`, `/projects/*`, `/inventory`, `/procurement`, `/purchase`, `/sales`, `/manufacturing`, `/pos`, `/reports`; `ComingSoonForAdmins` for `/analytics` and `/files`; `/hrms/soon/:key` | `shared/components/ComingSoon.tsx`, `ModuleComingSoon.tsx` | Yes (placeholders) |

### Where each module appears in the nav

**Today (`PlatformShell.tsx`):**
- Compliance group (`key: 'compliance'`) has two items: Statutory Compliance and Muster Roll.
- HR Setup group (`key: 'hrsettings'`, rendered in `railBottom`, i.e. at the bottom of the rail) holds HR Configuration, Notification Templates and Integrations.
- Master group holds the "Rules & Policies" child (path `/hrms/master/shift-rules`, `also: ['/hrms/policies']`).
- The Reports group holds Workforce Analytics.
- Settings is not in the rail. It is reached from:
  - the header gear (`canSettings`)
  - the profile menu's "Settings"
  - the mobile nav's "Settings"
- Settings pages show `SETTINGS_NAV` as the section tab row.

**Design (`hrms-core.js`):**
- Rail group "Org & policy" = `compliance`, `hrsetup`. Rules & policies sits in "People → Workforce" and Workforce analytics in "Insights → Reports".
- `settings` is not in the rail. It opens only from the More panel: "SETTINGS → Preferences" (`openSettings`, admin persona only). For other personas the prototype only shows a toast: "Opens your account settings: photo, sign-in and alerts".
- The top bar has no gear and no profile menu (only Pages, pill tabs, search, bell).

---

## 2. Statutory compliance (PgSetup `P['cp-stat']`)

**Tabs.** Design tabs are Compliance calendar, Statutory filings, POSH register and Inspector access. Today they are the same names and order (`Views` with `aria-label="Compliance views"`, kept in `?view=`). The company picker shows when there is more than one company; the design has none (keep it, see §15).

### 2.1 Compliance calendar tab
| Data point (design) | Source today | Status |
|---|---|---|
| Stat "Pending" (Not yet due or done) | `useComplianceItems` → `GET /v1/compliance/items?companyId&page&size` (counted over the page) | partial: page-scoped (the page says "On this page"); no aggregate endpoint |
| Stat "Overdue" | same (OVERDUE derived server-side at read time) | partial: page-scoped |
| Stat "Completed · This year" | same | partial: page-scoped, no year filter |
| "Filing calendar" month grid with day tags (title + tone) | `FilingCalendar` → `GET /v1/compliance/calendar-events?companyId&from&to` (items + filings: id, title, type, date, status, category, ownerName) | exists (UI shows "N due" per day today) |
| Table: Obligation (title) | items.title | exists |
| Category (sub-line) | items.category | exists |
| Due date | items.dueDate | exists |
| Frequency | items.frequency | exists (unused) |
| Owner | items.ownerName (enriched in `ComplianceController.enrichItems`) | exists |
| Status pill Pending / Overdue / Completed | items.status (PENDING/OVERDUE/DONE) | exists |
| Segmented filter Everything / Pending / Overdue / Completed | none (no `status` param on `/items`) | partial: only a client filter over one page |

| Action | API | Status |
|---|---|---|
| **Add obligation** (header). Fields: Obligation, Due date, Frequency, Category, Owner | `useCreateComplianceItem` → `POST /v1/compliance/items` (Owner picker: `useEmployeeDirectory` → `GET /v1/hrms/employees`) | exists (the design's selects for Frequency and Category are UI only; free text is stored) |
| **Mark done** (row) | `useMarkComplianceDone` → `POST /v1/compliance/items/{id}/done` | exists |
| Calendar: previous/next month, pick a day | UI | exists |

### 2.2 Statutory filings tab
| Data point | Source | Status |
|---|---|---|
| Filing type (+ authority sub-line "PF ECR · EPFO") | `useStatutoryFilings` → `GET /v1/compliance/filings` `.filingType` (PF, ESI, TDS, PT, GRATUITY, OTHER) | partial: **LWF** and **TDS return (24Q)** (vs challan 281) are not enum values. The authority label is a UI mapping |
| Period | `.period` | exists |
| Amount | `.amount` | exists |
| Due date | `.dueDate` | exists |
| Reference (challan) | `.referenceNo` | exists |
| Status Filed / Filed late / Overdue / Scheduled | `.status` DUE/FILED/LATE | exists: Overdue = DUE past due date, Scheduled = DUE not yet due (derived) |
| Segmented filter All filings / Filed / Overdue / Scheduled | none (no `status` param on `/filings`) | partial |
| (today also shows a "Filed" date column) | `.filedDate` | keep |

| Action | API | Status |
|---|---|---|
| **Schedule filing** (header): type, period, due date, amount | `useCreateFiling` → `POST /v1/compliance/filings` | exists |
| **Mark filed** (row): Filed date + Challan reference | `useFileFiling` → `POST /v1/compliance/filings/{id}/file` `{referenceNo}` | partial: `FileFilingRequest` has only `referenceNo`. The server stamps today and sets LATE if today > due. Design lets you pick the filed date |

### 2.3 POSH register tab
| Data point | Source | Status |
|---|---|---|
| Stats "Complaints this year": Received, Under inquiry, Resolved, Closed (incl. dismissed) | none | missing: no aggregate. "Closed" is not a status (enum RECEIVED/UNDER_INQUIRY/RESOLVED/DISMISSED) |
| Case number | `usePoshComplaints` → `GET /v1/compliance/posh` `.complaintNo` | exists |
| Department (case sub-line, e.g. "POSH-2026-004 · Engineering") | none | **missing**: `compliance_mgmt.posh_complaints` has no department column |
| Filed date | `.filedDate` | exists |
| Severity pill | `.severity` (LOW/MEDIUM/HIGH/CRITICAL today; design shows Low/Medium/High) | exists |
| Status pill | `.status` | partial: no "Closed" |
| Sub-line "Closing a complaint is final…" | static copy | n/a |
| (today also shows Resolved date + confidentiality note) | `.resolvedDate` | keep |

| Action | API | Status |
|---|---|---|
| **Register complaint** (header): Filed date, Severity, Department, Description | `useCreatePoshComplaint` → `POST /v1/compliance/posh` | partial: no department |
| **Resolve** (row, Under inquiry) | `useUpdatePoshStatus` → `POST /v1/compliance/posh/{id}/status` `{status:'RESOLVED', resolution}` (today via `ClosePoshModal`) | exists |
| **Close** (row, on a Resolved case) | none | **missing** and **conflicts**: today RESOLVED and DISMISSED are final ("its status cannot be changed afterwards") |
| (today also: move to Under inquiry, Dismiss) | same endpoint | keep |

### 2.4 Inspector access tab
| Data point | Source | Status |
|---|---|---|
| Inspector name · organisation | `GET /v1/compliance/inspector-sessions?companyId&page&size` `.inspectorName/.inspectorOrg` | exists |
| Audit (purpose) | `.purpose` | exists |
| Access ends | `.expiresAt` | exists |
| Last opened | `.lastAccessedAt` | exists |
| Status Active / Access revoked / Ended | `.status` ACTIVE/REVOKED/EXPIRED | exists |
| "How inspector links work" and "They will see" cards | static copy | n/a |
| Documents view: title, size, **Shared (date)** | `GET /v1/compliance/inspector-sessions/{id}/documents` → `{id,title,sizeBytes}` (`InspectionDocuments.Item`) | partial: no date. `inspection_documents.created_at` exists but isn't selected |

| Action | API | Status |
|---|---|---|
| **Create inspection link** (header). Fields: name, organisation, purpose, access ends within 7 days. Then "link copied" | `POST /v1/compliance/inspector-sessions`, then `POST /v1/compliance/inspector-sessions/{id}/link` → token → `/inspection#token` | exists |
| **Documents** (row) | `GET …/{id}/documents` | exists |
| **Revoke** (row) | `POST …/{id}/revoke` | exists |
| **Share PDF** (≤ 5 MB) | `POST …/{id}/documents` (multipart) | exists |
| **Unshare** | `DELETE …/{id}/documents/{docId}` | exists |
| (today also: **Get link** for an active session) | `POST …/{id}/link` | keep (not in design) |

### 2.5 Permissions today
- **Nav/search:** `pageRegistry.ts` has `page('compliance', 'Statutory Compliance', '/hrms/compliance', …, [{ ...any('hrms.compliance.read', 'hrms.compliance.write', 'hrms.compliance.posh', 'hrms.compliance.inspector.read'), module: HR }])`.
- **Route:** `App.tsx` has `<RouteGuard anyOf={['hrms.compliance.read', 'hrms.compliance.write', 'hrms.compliance.posh', 'hrms.compliance.inspector.read']}><ModuleGate moduleKey="hrms"><Compliance/>`.
- **Tabs:**
  - Calendar and filings need `usePermission('hrms.compliance.read')` (registry `tab(…,[any('hrms.compliance.read')])`).
  - POSH needs `'hrms.compliance.posh'`.
  - Inspector needs `canRead || canInspectorRead` (`'hrms.compliance.inspector.read'`).
- **Header actions:**
  - Add obligation and Schedule filing need `'hrms.compliance.write'`.
  - Register complaint needs `'hrms.compliance.posh'`.
  - Inspector create, Get link, Revoke, Share and Unshare need `write || 'hrms.compliance.inspector.write'`.
  - The Owner picker needs `'hrms.employee.read'`.
- **Backend (`ComplianceController`, `InspectorAccessController`, `InspectionDocumentController`):**
  - `GET /items`, `/filings`, `/calendar-events` require `hasAuthority('hrms.compliance.read')`.
  - `POST /items`, `/items/{id}/done`, `/filings`, `/filings/{id}/file` require `hasAuthority('hrms.compliance.write')`.
  - All of `/posh*` requires `hasAuthority('hrms.compliance.posh')`.
  - Inspector list and documents list require `hasAnyAuthority('hrms.compliance.inspector.read','hrms.compliance.read')`.
  - Create, revoke, link, share and unshare require `hasAnyAuthority('hrms.compliance.inspector.write','hrms.compliance.write')`.
  - `/v1/public/inspector-view*` needs no login; it is scoped by the signed token.

### 2.6 Gaps
| Gap | Backend work | Schema change | Size |
|---|---|---|---|
| Summary counts: obligations pending/overdue/completed this year; filings by status; POSH by status this year | `GET /v1/compliance/summary?companyId&year` (read). The POSH part is returned only with `hrms.compliance.posh`. Repository count queries; OVERDUE derived by due date | No | S |
| Status filters | `status` param on `GET /items` (PENDING/OVERDUE/DONE) and `GET /filings` (FILED incl. LATE / OVERDUE / SCHEDULED) | No | S |
| Filed date on Mark filed | `FileFilingRequest.filedDate` (optional, ≤ today); LATE when filedDate > dueDate | No (`filed_date` exists) | S |
| Filing types LWF, TDS return (24Q) | add `FilingType` constants (VARCHAR(30), no CHECK constraint, see `V074`) | No (JPA enum only) | S |
| POSH department | new nullable column `compliance_mgmt.posh_complaints.department_id` by migration. **Not mapped in the JPA entity `PoshComplaint`** (ddl-auto=validate); read/write with JdbcTemplate; request/response fields; the field stays hidden until the migration is applied | **Yes: new column on a JPA-mapped table** | M |
| POSH "Closed" status | add `PoshStatus.CLOSED`; RESOLVED → CLOSED allowed; CLOSED/DISMISSED final (`PoshService`) | No (VARCHAR, no CHECK) | S (needs decision) |
| Shared date on inspection documents | select `created_at` in `InspectionDocuments.Item` (JDBC, not JPA) | No | S |

### 2.7 Conflicts
- POSH "Close" after "Resolved" conflicts with today's rule that Resolved and Dismissed are final.
- The design has no "Get link" (keep it) and no company picker (keep it).
- FilingCalendar is a custom Sunday-first grid using `date-fns` and the browser's date. The client rule is that the calendar = `src/shared/components/calendar` (Monday-first `DayGrid`, IST `istToday`). Rebuild the filing month view on the shared calendar parts and legend.
- "Access ends" today is a native `datetime-local`; move it to `DateField`.

### 2.8 Components
PageHeader (crumb, title, sub, primary action per tab), PillTabs, StatCard, MonthCalendar (day tags + legend), Card/Section, SegmentedControl, StatusPill, table card (UtSection `table`: avatar/plain first column, pills, row actions, empty state), key-value card (UtSection `kv`), SidePanel (add obligation, schedule filing, mark filed, register complaint, create link, documents), Dialog (revoke, close case), FormField (input/select/textarea + `DateField`), Dropdown (company), EmptyState, Skeleton, Toast.

---

## 3. Rules & policies (PgSetup `P['m-rules']`)

**Today there are two versions:**
- Policy admins (`hrms.policy.write` && `hrms.policy.read`) get Master's generated pages via `PoliciesRoute` → `MasterContainer`: Shift Rules `/hrms/master/shift-rules`, Leave Rules `/hrms/master/leave-rules`, Policy Documents `/hrms/policies`, under Master's own "Rules & Policies" top tab.
- Everyone else gets `Policies.tsx` at `/hrms/policies` with views Policies / Shift Rules / Leave Rules / Manage (by permission, `?view=`).

The design is one page with 4 tabs: Policies, Shift rules, Leave rules, Manage policies (the same order as `Policies.tsx`).

### 3.1 Policies tab (your policies)
| Data point | Source | Status |
|---|---|---|
| Stat "Active policies · Published" | `usePolicies(page,'ACTIVE')` → `GET /v1/policy/policies?status=ACTIVE` `.totalElements` | exists |
| Stat "You've acknowledged" | `useMyAcknowledgements` → `GET /v1/policy/my-acknowledgements` ∩ page | partial: page-scoped when more than 1 page |
| Stat "Still to acknowledge" | same + `acknowledgementRequired` | partial: page-scoped |
| Table: Policy, Category, Version, Effective date | policy fields | exists |
| Status Acknowledged / To acknowledge / For reading | my-acks + `acknowledgementRequired` | exists |
| Read view: title, category · version · effective | `usePolicy` → `GET /v1/policy/policies/{id}` | exists |
| Read view "Summary" | `.content` | exists |
| Read view "Owner" (HR · name) | none in `PolicyResponse` (`created_by` exists in `BaseEntity`) | partial |
| Read view "Applies to" (Everyone in <company>) | `.companyId` → company name (`useCompanies`) | exists |

Actions:
- **Read**: `GET /v1/policy/policies/{id}`. Exists.
- **Acknowledge**: `useAcknowledgePolicy` → `POST /v1/policy/policies/{id}/acknowledge`. Exists.

### 3.2 Shift rules tab
| Data point | Source | Status |
|---|---|---|
| Shift, Shift type, Timing (Flexi: core hours), Grace, Hours/day, Overtime (multiplier or "No overtime") | `useShiftPolicies` → `GET /v1/shifts?companyId` (`attendance.shift_policies`) | exists (today also has code and weekly offs: keep) |

Actions:
- **Add Shift Rule**: `POST /v1/shifts?companyId`. Exists.
- **Edit**: `PUT /v1/shifts/{id}`. Exists.
- **Delete**: `DELETE /v1/shifts/{id}` (409 when in use). Exists.

### 3.3 Leave rules tab
| Data point | Source | Status |
|---|---|---|
| Leave type, Entitlement (N days a year / accrual), Paid, Carry forward (None / up to N days) | `GET /v1/leave/types?companyId` (`annualEntitlement`, `accrualFrequency`, `isPaidLeave`, `isCarryForwardAllowed`, `maxCarryForwardDays`) | exists |

Action: **Open leave types** → `/hrms/leave?tab=types`. Exists.
- **Conflict:** the design makes this tab read-only; today it edits leave types here (Master LeavesPage / `LeaveTypes` widget).

### 3.4 Manage policies tab
| Data point | Source | Status |
|---|---|---|
| Segmented All / Active / Draft / Archived | `GET /v1/policy/policies?status=` (one status per call; Master runs 3 calls of 200) | partial: no "All" |
| Policy, Category, Version, Status | policy fields | exists |
| Acknowledged "231 of 249" | `.acknowledgementCount` | partial: no denominator (audience count) |

Actions:
- **Publish Policy** (header). Fields: Title, Category, Version, Effective date, Content. `POST /v1/policy/policies?companyId`, then `POST /{id}/publish`. Exists.
- **Edit**: `PUT /{id}`. Exists.
- **Archive**: `POST /{id}/archive`. Exists.
- **Publish** (draft): `POST /{id}/publish`. Exists.
- **Restore**: `POST /{id}/unarchive`. Exists.
- Today also: **Remind** (`POST /{id}/remind`), delete draft (`DELETE /{id}`), acknowledgement list (`GET /{id}/acknowledgements`), and publish options (acknowledgement required, email on publish, automatic reminder). Keep all of these.

### 3.5 Permissions today
- **Nav:**
  - The Master child "Rules & Policies" → `menuRule('/hrms/master/shift-rules')` = `page('m-shift-rules', …, [{ ...any('attendance.workforce.admin', 'hrms.policy.write'), module: HR }])`.
  - Leave rules: `page('m-leave-rules', …, [{ ...any('leave.type.write', 'hrms.policy.write'), module: HR }])`.
  - Policies: `page('policies', …, [{ ...any('hrms.policy.read', 'hrms.policy.write', 'hrms.policy.acknowledge.self'), module: HR }])`.
- **Routes:**
  - `/hrms/master/*` uses `RouteGuard anyOf=[HRMS_EMPLOYEE_READ, HRMS_DEPARTMENT_WRITE, HRMS_BRANCH_WRITE, HRMS_DESIGNATION_WRITE, HRMS_CONTRACTOR_READ, LEAVE_TYPE_WRITE, 'hrms.policy.write', 'attendance.workforce.admin', PAYROLL_COMPONENTS_READ, PAYROLL_SETTINGS_READ]`.
  - `/hrms/policies` uses `anyOf=['hrms.policy.read','hrms.policy.write','hrms.policy.acknowledge.self']`, then `PoliciesRoute`: `permissions.has('hrms.policy.write') && has('hrms.policy.read')` → Master.
- **In page, Master:**
  - `visible.shifts = canShiftAdmin || canPolicyWrite`
  - `leaves = canLeaveWrite || canPolicyWrite`
  - `policies = canPolicyWrite && canPolicyRead`
  - writable: shifts `attendance.workforce.admin`, leaves `leave.type.write`, policies `hrms.policy.write`
- **In page, `Policies.tsx`:**
  - Shift Rules requires `P.ATTENDANCE_REGULARIZATION_APPROVE` ⚠ (the backend write needs `attendance.workforce.admin`, see risks).
  - Leave Rules requires `P.LEAVE_TYPE_WRITE`.
  - Policies requires `['hrms.policy.read','hrms.policy.acknowledge.self']`.
  - Manage requires `'hrms.policy.write'`.
- **Backend (`/v1/policy`):**
  - Create, update, publish, archive, unarchive, remind and delete require `hasAuthority('hrms.policy.write')`.
  - List and get require `hasAnyAuthority('hrms.policy.read','hrms.policy.acknowledge.self')`.
  - Acknowledge and `my-acknowledgements` require `'hrms.policy.acknowledge.self'`.
  - The acknowledgements list requires `'hrms.policy.read'`.
- **Backend (`/v1/shifts`):**
  - GET requires `'attendance.checkin.self'`.
  - POST, PUT and DELETE require `'attendance.workforce.admin'`.
- **Backend (`/v1/leave/types`):** GET is `isAuthenticated()`; writes require `'leave.type.write'`.

### 3.6 Gaps
| Gap | Backend work | Schema | Size |
|---|---|---|---|
| My acknowledgement summary (not page-scoped) | `GET /v1/policy/my-summary` (`acknowledge.self`): active, requiring acknowledgement, acknowledged at current version | No | S |
| "N of M" audience | `PolicyResponse.audienceCount` (active employees of the policy's company) | No | S |
| Policy owner | `PolicyResponse.ownerName` from `created_by` | No | S |
| "All" status list | `status=ALL` (or a list) for write-holders | No | S |

### 3.7 Conflicts
- Admins today never see "your policies to acknowledge" on `/hrms/policies` (they get Master). The design gives them a Policies tab.
- Leave rules: read-only in the design vs editable today.
- Crumb: design "Workforce", today "HR setup".
- Keep these URLs: `/hrms/master/shift-rules`, `/hrms/master/leave-rules`, `/hrms/policies` (+ `?view=`).
- Overlaps:
  - Shift rules ↔ PgTime `a-shifts` (Shifts & overtime)
  - Leave rules ↔ PgLeave "Leave types"
  - Employee view of `/hrms/policies` ↔ EmpDocs "Policies" (`e-pol`, self-service audit)

### 3.8 Components
PageHeader, PillTabs, StatCard, table card, StatusPill, SegmentedControl, SidePanel (shift rule form with overtime toggle, publish/edit policy, policy read view with Acknowledge), key-value card, Dialog (archive/delete), FormField (time, number, select, textarea, toggle), EmptyState, Toast.

---

## 4. HR configuration (PgSetup `P['hs-config']`)

A single page. Header primary "Save changes". The design shows 8 half-width form cards plus a "Recent reminders" table. Today it uses SettingsKit sections with a sticky "On this page" list, an unsaved-changes bar, a leave-page guard and a company picker.

| Data point (design field) | Source today | Status |
|---|---|---|
| Employee IDs: Prefix, Next number, "Next employee code: EMP-0250" | `useHrConfig(co)` → `GET /v1/settings/hr-configuration?companyId` (`employeeCodePrefix/NextNumber/Padding`); preview computed (also `GET /v1/settings/employee-code/preview`) | exists |
| Probation: Default probation | `.probationPeriodMonths` | exists (design uses 3/6/12 select, today a number 0–24: keep) |
| Remind managers and HR | `useProbationConfig` → `GET /v1/probation/config` `.reminderDaysBefore` | exists |
| Extend by | `.autoExtendDays` | exists (design shows months, stored in days) |
| Default notice period, Retirement age | `.defaultNoticePeriodDays`, `.retirementAge` | exists |
| Week starts on, Weekly off days | `.workweekStartDay`, `.weekendDays` | exists (today day chips: keep) |
| Late arrival: company grace, start time without a shift, half day if later than, late arrivals allowed, allowance resets every, after the allowance | `useAttendancePolicy` → `GET /v1/attendance/policy?companyId` | exists |
| Attendance rules: minimum hours full day / half day, early leave after | same | exists |
| Switches: geofencing on mobile, allow work from home, extend probation automatically | `.enforceGeofencingForMobile`, `.allowWorkFromHome`, probation `.autoExtendEnabled` | exists |
| Fiscal year starts in | `.fiscalYearStart` (company record) | exists |
| Recent reminders: Reminder (Probation ends · name), Sent | `useProbationReminders` → `GET /v1/probation/reminders` (`employeeName`, `probationEndDate`, `reminderType`, `sentAt`) | exists |
| Recent reminders: **To** (manager and HR) | not returned (`hrms.probation_reminder_log.notified_user_ids UUID[]` exists) | partial |

Actions:
- **Save changes**: `PUT /v1/settings/hr-configuration?companyId` + `PUT /v1/attendance/policy` + `PUT /v1/probation/config` (only changed groups). Exists.
- **Switches**: saved with the page. Exists.
- **Send reminders now**: `POST /v1/probation/scan-now`. Exists.
- Keep today's company picker, Discard, section errors and the leave guard.

**Permissions today:**
- Registry: `page('hr-config', …, [{ anyOf: ['settings.hrconfig.write', 'settings.read', 'hrms.probation.config.read', 'attendance.policy.manage'], module: HR }])`.
- Route: `/hrms/settings` and `/work-time` use `RouteGuard anyOf=[SETTINGS_HRCONFIG_WRITE, SETTINGS_READ, HRMS_PROBATION_CONFIG_READ, 'attendance.policy.manage']`.
- In page:
  - `canHrWrite = usePermission(P.SETTINGS_HRCONFIG_WRITE)` (IDs, probation length, notice, retirement, week, geofence/WFH, fiscal)
  - `canProbRead/Write` (`hrms.probation.config.read/update`)
  - `canReminders` (`hrms.probation.reminders.read`)
  - `canPolicy = usePermission('attendance.policy.manage')` (late + attendance rules)
- Backend:
  - `GET /v1/settings/hr-configuration` requires `hasAnyAuthority('settings.read','settings.hrconfig.write','hrms.employee.write','attendance.policy.manage')`; PUT requires `hasAuthority('settings.hrconfig.write')`.
  - `/v1/probation/config` GET requires `hrms.probation.config.read`; PUT and `/scan-now` require `hrms.probation.config.update`; `/reminders` requires `hrms.probation.reminders.read`.
  - `/v1/attendance/policy` PUT requires `hasAuthority('attendance.policy.manage')`.
- Checked live: the built-in **HR_MANAGER role has no `settings.hrconfig.write` or `settings.read`**. HR sees IDs, probation length, notice, week and fiscal year read-only, and edits reminders and attendance rules. Keep per-section view-only states under one "Save changes".

**Gap:**
- Probation reminder recipients: map `notified_user_ids` → names in `GET /v1/probation/reminders` (JDBC log table). No schema change. S.

**Conflicts:**
- The design has no section list, unsaved bar or company picker. Keep the behaviour (tests `live-design-hrconfig.mjs` assert "On this page", "Unsaved changes" and "2 changes · not saved yet").
- The design uses fixed selects where today's inputs are wider: keep today's inputs.

**Components:** PageHeader (+ Save changes), Card/Section (form cards, half width), FormField (text, number, time, select, toggle), table card (reminders), Dropdown (company), Toast, Skeleton, EmptyState. Page-specific: the unsaved-changes bar and the view-only notice (from SettingsKit, restyled).

---

## 5. Notification templates (PgSetup `P['hs-notif']`)

| Data point | Source | Status |
|---|---|---|
| Stat Templates (In this company) | `useNotificationTemplates` → `GET /v1/notiftemplate/templates?companyId&page` `.totalElements` | exists |
| Stat Active | counted over the page | partial: page-scoped |
| Stat Channels used (+ list) | counted over the page | partial: page-scoped |
| Segmented All channels / Email / Push / In-app | none (no `channel` param) | partial |
| Table: Template, Channel, Event, Status (Active / Off · built-in wording; today also "Not used") | template fields + `useNotificationEvents` → `GET /v1/notiftemplate/events` | exists |
| Editor "You can use" placeholders | events[].placeholders | exists |

Actions:
- **New template**: `POST /v1/notiftemplate/templates`. Exists.
- **Edit**: `PUT /templates/{id}`. Exists.
- **Delete**: `DELETE /templates/{id}`. Exists.
- Start from built-in wording: events[].defaults. Exists.
- Active toggle. Exists.
- SMS channel exists today; the design shows 3 channels. Keep SMS where the event allows it.

**Permissions:**
- Registry: `page('notif-templates', …, [{ ...any('hrms.notiftemplate.read', 'hrms.notiftemplate.write'), module: HR }])`. The route has the same `anyOf`.
- In page: `usePermission('hrms.notiftemplate.read' / '.write')`.
- Backend: list/get require `hasAuthority('hrms.notiftemplate.read')`; create/update/delete require `'hrms.notiftemplate.write'`; `/events` requires `hasAnyAuthority(read,write)`.

**Gap:** `channel` filter on `GET /templates` + summary counts (total, active, channels). No schema change. S.

**Components:** PageHeader, StatCard, SegmentedControl, table card, StatusPill, SidePanel (editor with a placeholders key-value card and an Active toggle), FormField, Dialog (delete), EmptyState, Toast.

---

## 6. Integrations (HR setup) (PgSetup `P['hs-int']`)

| Data point | Source | Status |
|---|---|---|
| Stat Services recorded | `useIntegrationConnections` → `GET /v1/integration/connections?companyId&page` `.totalElements` | exists |
| Stat Marked configured | counted over the page | partial: page-scoped |
| Stat Needs attention (+ the service's name) | counted over the page (`status=ERROR`) | partial: page-scoped. Nothing in the product can set ERROR (`/toggle` flips CONNECTED↔DISCONNECTED only) |
| Table: Name, Provider, Category, Status, Recorded | connection fields (`createdAt`) | exists |

Actions:
- **Add integration** (side panel: Name, Provider, Category, Notes): `POST /v1/integration/connections` (Notes → `configSummary`). Exists.
- **Mark configured / not configured**: `POST /connections/{id}/toggle`. Exists.
- Today also **Remove** (`DELETE`). Keep it.

**Permissions:**
- Registry: `page('hr-integrations', …, [{ ...any('hrms.integration.read', 'hrms.integration.write'), module: HR }])`. The route has the same `anyOf`.
- In page: `usePermission('hrms.integration.write')`.
- Backend: list requires `hasAuthority('hrms.integration.read')`; create/toggle/delete require `'hrms.integration.write'`.

**Gap:** summary counts + a way to flag and clear "Needs attention" (`POST /connections/{id}/status`). No schema change. S.

**Components:** PageHeader, StatCard, table card, StatusPill, SidePanel, FormField, Dialog, EmptyState, Toast.

---

## 7. Workforce analytics (PgSetup `P['r-wfa']`)

Today it is one page (generated `design/dc/WorkforceAnalytics.view.tsx`) with company and period pickers and exports. The design splits it into 3 tabs.

| Tab / data point | Source | Status |
|---|---|---|
| Headcount: "On <date>" (any date) | `useHeadcountReport(co, asOf)` → `GET /v1/reports/headcount?companyId&asOf` | exists (UI needs the as-of `DateField`) |
| Headcount, Active, Probation, On notice | headcount rows (`total`, `active`, `probation`, `on_notice`) | exists |
| By department bars | same rows | exists |
| Headcount · last 6 months chart | only via `GET /v1/reports/attrition` `.headcount` (needs `hrms.report.attrition`) | partial: a headcount-only viewer can't get it |
| Attrition: period "April – September" (financial year) | periods today: last 12 months / year so far / last calendar year | partial (UI; company `fiscalYearStart` exists) |
| Exits, Attrition rate (annualised), Resigned, Terminated, Other | `useAttritionReport` → `GET /v1/reports/attrition?companyId&from&to` (`exits`, `resignations`, `terminations`, `other_exits`, `headcount`, `attrition_pct`) | exists (rate derived) |
| Exits per month chart, Monthly trend table | same | exists |
| Diversity: Women / Men / Other or not said (% and count) | `useDiversityReport` → `GET /v1/reports/diversity` | exists |
| Women by department bars | same (by `department_id`) | exists |

Actions:
- **Download** per tab (Excel): client `xlsxBlob` + export log (`saveAndRecord` → `POST /v1/reports/exports`). Exists.
- Keep CSV, PNG and PDF (`GET /v1/reports/workforce-analytics/export.pdf`), the company and period pickers, and the department → directory drill-down.

**Permissions:**
- Registry: `page('workforce-analytics', …, [{ ...any('hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.diversity'), module: HR }])`.
- Route: `RouteGuard anyOf=[HRMS_REPORT_HEADCOUNT, HRMS_REPORT_ATTRITION, HRMS_REPORT_DIVERSITY]`.
- Per tab: `canHead`/`canAttr`/`canDiv` (`usePermission(P.HRMS_REPORT_*)`).
- Drill-down needs `P.HRMS_EMPLOYEE_READ`.
- Backend: `@PreAuthorize("@perm.check('hrms.report.headcount'|'attrition'|'diversity')")`; the PDF requires `hasAnyAuthority` of the three.

**Gap:** `GET /v1/reports/headcount/trend?companyId&from&to` under `hrms.report.headcount`. No schema change. S.

**Risk:** the page is a generated view (`scripts/design-build.mjs` rebuilds it from `docs/Designs/UnifiedTree Workforce Analytics (offline).html`). Replacing it means taking it out of design-build.
**Overlap:** the Reports audit.

**Components:** PageHeader (+ Download), PillTabs, StatCard, bar list (Meter/ProgressBar), column chart (page-specific), table card, Dropdown (company, period), `DateField`, EmptyState, Skeleton.

---

## 8. Settings (PgAdmin `P['s-config']`, 8 tabs)

### 8.1 Profile tab (`/settings`, `/settings/profile` → `WorkspaceProfileSettings`)
| Data point | Source | Status |
|---|---|---|
| Your account: Display name, Phone, Sign-in email, Role | `useCurrentUser` → `GET /v1/users/me`; role from the auth store | exists |
| Organisation: Workspace name, Contact email, Contact phone, Web address (read-only), Address line 1, Address line 2, City, State, PIN code, GSTIN, PAN | `useWorkspaceProfile` → `GET /v1/workspace/profile` | exists (design "State" select vs text: UI) |

Action: **Save profile**: `PUT /v1/users/me` + `PUT /v1/workspace/profile`. Exists.

### 8.2 Branding tab
| Data point | Source | Status |
|---|---|---|
| Workspace logo (square mark, wide logo, sizes) | `GET /v1/workspace/branding` | exists |
| "Where it shows" | static copy | n/a |

Actions:
- Upload and edit (in-browser crop, background removal with tolerance). Exists.
- **Save logo**: `POST /v1/workspace/branding/{mark\|logo}`. Exists.
- Remove: `DELETE`. Keep it.

### 8.3 Security tab
| Data point | Source | Status |
|---|---|---|
| Password "Last changed" | not in `GET /v1/me/security` (column `password_updated_at` exists in auth credentials) | partial |
| Two-factor status, recovery codes left ("8 of 10") | `useMfaStatus` → `GET /v1/me/security` | exists |
| Two-factor "App: Google Authenticator" | not knowable (TOTP works with any app) | missing: show "Authenticator app" |
| Active sessions: Device, Last active, Status (This device/Active) | `useSessions` → `GET /v1/me/security/sessions` | exists |
| Sessions "Where" (city, country) | only `ipAddress` | missing: needs IP-to-location |
| Workspace rule + "N people covered but not set up" | `useWorkspaceSecurity` → `GET /v1/workspace/security` | exists |

Actions:
- **Email me a password reset link**: `POST /v1/auth/forgot-password`. Exists.
- **Make new recovery codes**: `POST /v1/me/security/recovery-codes`. Exists.
- **Sign out** a session: `DELETE /v1/me/security/sessions/{id}`. Exists.
- **Sign out all other sessions**: `POST …/sessions/sign-out-others`. Exists.
- **Save rule**: `PUT /v1/workspace/security`. Exists.
- Keep: set up and turn off two-factor, and resetting a member's two-factor.

### 8.4 Notifications tab
Email / in-app / push choices per event (+ email and push master switches): `useNotificationChoices` → `GET/PUT /v1/me/notification-preferences`. Exists.
- The events come from `NotificationEventCatalog`. The design's sample rows ("Weekly summary", etc.) are sample data. There is no weekly digest in the catalog.

### 8.5 Billing & plan tab
| Data point | Source | Status |
|---|---|---|
| Plan + status (Active · autopay on) | `GET /v1/workspace/plan/current` | exists (local demo owner gets 403 "Your account isn't linked to this workspace": known data gap) |
| Seats "249 of 260 · 11 left" | plan seats + `useSeatsUsage` → `GET /v1/workspace/seats/usage` | exists |
| Next charge amount and date | `.amountInr`, `.nextChargeAt` | exists |
| Next charge method ("UPI autopay") | not returned | partial |
| Billing cycle | `.billingCycle` | exists |
| Modules table (module, seats, price a seat, status incl. "Launching soon") | `planKeys` + `useModulePlans` → `GET /v1/public/module-plans` | exists (UI) |
| Invoices (number, date, amount, Paid) + Download | none ("coming soon" today) | **missing** |

Actions:
- **Manage plan** → `/plan`. Exists.
- **Change seats** → `/plan` (`POST /v1/workspace/plan/change-seats`). Exists.
- **Download invoice**. **Missing.**

### 8.6 Integrations tab
Connections: Slack, Google Workspace (sign in), Microsoft Teams, Razorpay (autopay) with Connected / Not connected and **Connect**.
- **Missing**: today this tab is a static "Coming soon" roadmap (Slack, GitHub, Jira, Zapier, Stripe, Salesforce). No OAuth or connector code exists.
- Razorpay "Connected" could be derived from billing subscriptions.

### 8.7 Document types tab
Name, Code, Formats, Max size, Required, Expiry, Status: `GET /v1/document/types` (include inactive). Exists.

Actions:
- Add: `POST /v1/document/types`. Exists.
- Edit: `PUT /{id}`. Exists.
- Deactivate: `DELETE /{id}`. Exists.
- Activate: `PUT` active=true. Exists.

### 8.8 Danger zone tab
Data:
- Earlier export requests: `GET /v1/workspace/exports`. Exists.
- Reset/delete: what is removed and kept, plus status: `GET /v1/workspace/lifecycle-requests`. Exists.
- The rest is static copy.

Actions:
- **Prepare an export**: `POST /v1/workspace/exports`. Exists.
- Download: `GET /exports/{id}/download`. Exists.
- **Schedule reset** / **Schedule deletion**: `POST /v1/workspace/lifecycle-requests` `{kind, confirmName}`. Exists.
- Cancel: keep it.

### 8.9 Permissions today
**Entry points:**
- `const canSettings = SETTINGS_NAV.some(i => i.key !== 's-profile' && isVisible(i))` drives the header gear, the profile menu's "Settings" and the mobile item.
- `MENU_RULES['/settings'] = [{ anyOf: SETTINGS }]` with `const SETTINGS = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read']`.

**Tabs (registry):**
- `s-branding [any('settings.branding.write')]` (`SETTINGS_NAV` also lists roles, but those lists are no longer read)
- `s-security []` (everyone)
- `s-notifications [{ anyOf: SETTINGS }]`
- `s-billing [{ allOf: ['workspace.billing.manage'], when: planAdminOnly }]`
- `s-integrations [{ anyOf: SETTINGS }]`
- `s-documents [{ anyOf: SETTINGS }, any('hrms.document.type.read', 'hrms.document.type.write')]` (not in `SETTINGS_NAV`)
- `s-danger [any('workspace.data.export', 'workspace.lifecycle.manage')]`

**Routes:**
- `/settings` uses `RouteGuard anyOf=[SETTINGS_READ, SETTINGS_HRCONFIG_WRITE, SETTINGS_HOLIDAYS_WRITE, HRMS_PROBATION_CONFIG_READ, 'workspace.profile.update', 'workspace.security.manage']`.
- `/settings/:tab` uses the same list + `'settings.branding.write'`.
- `/settings/billing` uses `RequirePermission code={P.WORKSPACE_BILLING_MANAGE}`.
- `/settings/danger` uses `anyOf=['workspace.data.export','workspace.lifecycle.manage']`.
- `/settings/security` is auth-only.

**Backend:**
- `/v1/workspace/profile`: GET requires `hasAnyAuthority('workspace.context.read','workspace.profile.update','settings.read')`; PUT requires `'workspace.profile.update'`.
- Branding: GET is `isAuthenticated()`; POST/DELETE require `'settings.branding.write'`.
- `/v1/me/security*` and `/v1/me/notification-preferences` are `isAuthenticated()`.
- `/v1/workspace/security*` requires `'workspace.security.manage'`.
- `/v1/workspace/plan/current` has an admin check inside the controller.
- `/v1/document/types`: GET requires `'hrms.document.type.read'`; writes require `'hrms.document.type.write'`.
- Exports require `'workspace.data.export'`.
- Lifecycle requires `'workspace.lifecycle.manage'` (+ OWNER role to schedule).

### 8.10 Gaps
| Gap | Backend work | Schema | Size |
|---|---|---|---|
| Password last changed | add `passwordUpdatedAt` to `GET /v1/me/security` (auth credentials column exists; `UserCredentials` maps `password_updated_at`) | No | S |
| Session location | IP-to-location (GeoLite2 file or service) in `GET /v1/me/security/sessions`; or show IP | No (if computed on read) | M |
| Invoices + payment method | Razorpay Invoices/Subscriptions API (list, PDF download), `workspace.billing.manage`. Optionally record `subscription.charged` webhooks in a new JDBC-only table | No (live fetch) / Yes if stored | M |
| Workspace integrations (Slack, Microsoft Teams, Google Workspace sign-in) | Provider OAuth apps and secrets. New JDBC-only table (e.g. `platform.workspace_integrations`, encrypted tokens). Connect/callback/disconnect endpoints. New permission (e.g. `workspace.integrations.manage`) granted to OWNER + SUPER_ADMIN in its migration. Delivery adapters for Slack/Teams. A Google OIDC sign-in path | **Yes: new table** | L |

### 8.11 Conflicts
- **Entry points:** the design has no header gear or profile menu; the 26 Sep undo kept them.
- **Tab row:** the design has 8 settings tabs + 3 separate pages. Today there are 10 tabs, "Profile" → `/profile`, and no Document types.
- The prompt says "keep the tab names and order unchanged": this conflicts with the design's regrouping.
- **Profile tab:** in the design this is the workspace profile (`/settings/profile`), and "My profile" is PgProfile (`/profile`). The registry has no entry for `/settings/profile`: the `profile` page lists `'settings/profile'` as an alias of `/profile`.
- **Pre-existing:** the gear shows for every user (Security is open to all), but `/settings` sends employees to "Access Restricted". "Preferences" in More must route by permission:
  - anyone who can open `/settings` → `/settings`
  - everyone else → `/profile` (photo, notification switches, delegation) or `/settings/security`
- Notifications: `SETTINGS_NAV` says it is open to every role, but the route guard needs a settings permission. Employees use the same switches on `/profile`.

### 8.12 Components
PageHeader, PillTabs, Card/Section (form cards), FormField (input, select, toggle, slider), key-value cards, table cards (sessions, modules, invoices, connections, document types, requests), StatCard (plan), StatusPill, EmptyState (logo drop zone), SidePanel (document type), Dialog (sign out others, schedule reset/delete with typed name, remove logo), Toast. Page-specific: the logo editor, recovery codes, the two-factor QR step, and the unsaved-changes bar.

---

## 9. Users & access (PgAdmin `P['s-users']`)

| Data point | Source | Status |
|---|---|---|
| Stats Members, Active, Invited, No access yet | `useWorkspaceUsers` → `GET /v1/workspace/users` | exists |
| Segmented Everyone / Active / Invited / No access | client filter | exists |
| User (name · email), Roles, Status (Active / Invited / "Invitation didn't go out" / No access) | `.firstName/.lastName/.email`, `.roles`, `.status`, `.invitationSendStatus`, `.lastSendError` | exists |
| Last sign-in | `.lastLoginAt` (verified in the live response) | exists (unused) |
| Manage access: Module access switches (HRMS, Payroll, Accounts "Launching soon") | no per-user module-access concept; derived from roles per module (`GET /v1/workspace/assignable-roles` `moduleActive`) | partial |
| Assigned roles: Role | user roles | exists |
| Assigned roles: Granted (date), By | not returned (`rbac.user_roles.granted_at`, `granted_by` exist) | partial |

| Action | API | Status |
|---|---|---|
| **Invite user** (Email, Role, **Message**) | `useInviteWorkspaceUser` → `POST /v1/workspace/users/invite` | partial: no message field. Today's form also has names, "create employee" and several roles: keep |
| **Resend / Retry invitation** | `POST /v1/workspace/users/{id}/invite/resend` | exists |
| **Manage access** | `GET /v1/workspace/users/{id}/permissions` | exists |
| **Revoke role** | `DELETE /v1/workspace/users/{id}/roles/{roleCode}` | exists |
| **Grant role** | `POST /v1/workspace/users/{id}/roles` | exists |
| **Module access switch** | none | missing (what "on" should grant is undefined) |
| (today also: extra/removed permissions, what they can do) | `PUT /v1/workspace/users/{id}/permissions` (`rbac.access.manage-overrides`) | keep (not in design) |

**Permissions:**
- Registry: `page('users', …, [any('workspace.users.read')])`.
- Route: `RouteGuard anyOf=[P.WORKSPACE_USERS_READ]`.
- In page: `canRead = usePermission(P.WORKSPACE_USERS_READ)`, `canManage = usePermission(P.WORKSPACE_USERS_MANAGE)` (Invite, Resend, Manage access).
- Backend: `GET /users` and `/assignable-roles` require `hasAuthority('workspace.users.read')`; role grant/revoke, invite and resend require `'workspace.users.manage'`; permissions view requires `hasAnyAuthority('workspace.users.read','rbac.access.manage-overrides')`; PUT requires `'rbac.access.manage-overrides'`.
- Levels are enforced on the server: only what you hold; critical permissions only from the owner.

**Gaps:**
- `grantedAt` + `grantedBy` (name/email) per role in `GET /v1/workspace/users`. S. No schema change.
- Optional invite `message` + email placeholder. S.
- Module switch semantics (see questions). S.

**Components:** PageHeader (+ Invite user), StatCard (clickable), SegmentedControl, search input, table card with Avatar, StatusPill, row actions, SidePanel (invite; manage access: switches, assigned roles table, grant form, overrides), Dialog (last role, high-risk confirm), Toast.

---

## 10. Roles & permissions (PgAdmin `P['s-roles']`)

| Tab / data point | Source | Status |
|---|---|---|
| Stats Roles, Built-in, Custom | `useRoles` → `GET /v1/rbac/roles` (`systemRole`) | exists (today also a Permissions tile: keep) |
| Roles table: Role, Type (Built-in/Custom) | same | exists |
| Roles table: **Permissions** (count) | not in `/v1/rbac/roles` (only `/v1/workspace/assignable-roles` `.permissionCount`, gated by `workspace.users.read`) | partial |
| Roles table: **People** (holders) | none | missing |
| Role permissions view: grouped by module, code, "What it lets someone do", Allowed / high risk | `usePermissionsCatalogue` → `GET /v1/rbac/permissions` + `useRolePermissions` → `GET /v1/rbac/roles/{id}/permissions` | exists |
| Role view sub "N people hold it" | none | missing (same as People) |
| Who has which role: User, Assigned roles, Status | `GET /v1/workspace/users` | exists |
| Catalogue: code, module, description, Risk; module filter | catalogue | exists (4 risk levels vs design's 2: keep 4) |

Actions:
- **New role** (code, name, description, "Start from"): `POST /v1/rbac/roles` or `POST /roles/{id}/duplicate`. Exists.
- **View/Edit permissions**, **Save permissions**: `PUT /v1/rbac/roles/{id}/permissions?acknowledgeRisk`. Exists.
- **Duplicate role**. Exists.
- **Manage** (assignment): `POST/DELETE /v1/rbac/users/{uid}/roles/{roleId}`. Exists.
- Keep edit and delete role.

**Permissions:**
- Registry: `page('roles', …, [any('rbac.role.write', 'platform.admin')])` + tabs `assignments`/`catalogue` `[]`.
- Route: `RouteGuard anyOf=[P.RBAC_ROLE_WRITE, P.PLATFORM_ADMIN]`.
- In page: `canWriteRoles = usePermission(P.RBAC_ROLE_WRITE)`; row actions use `<Can code={P.RBAC_ROLE_WRITE}>`.
- Backend:
  - GET roles requires `hasAuthority('rbac.role.write') or hasAuthority('platform.admin')`.
  - Writes require `'rbac.role.write'`.
  - `/permissions` requires `hasAnyAuthority('rbac.role.write','platform.admin','workspace.users.read','rbac.access.manage-overrides')`.
- Note: "Who has which role" lists users via `workspace.users.read`, so a role with only `rbac.role.write` gets a 403 there. Gate the tab on both.

**Gap:** `permissionCount` + `holderCount` in `GET /v1/rbac/roles`. S. No schema change.

**Components:** PageHeader (+ New role), PillTabs, StatCard, table card, StatusPill (type, risk), SegmentedControl (module), SidePanel (new role; permissions with switches grouped by module; read-only table for built-in roles; Duplicate), Dialog (delete, high-risk), Avatar, Toast.

---

## 11. Audit logs (PgAdmin `P['s-audit']`)

| Data point | Source | Status |
|---|---|---|
| Who (name · email) | `useAuditEvents` → `GET /v1/audit/events` `.actorName/.actorEmail` | exists |
| Action as a sentence ("Locked attendance") | API returns `.summary` (e.g. "Attendance policy saved: grace 17 min…") and `.module`; not in `AuditEventDto`, not shown | exists (unused) |
| Resource | `.resourceType` + `.resourceName` | exists |
| When | `.occurredAt` | exists |
| Segmented All actions / Sign-ins / Changes / Exports / Permissions | `action` filter = one exact value | partial: "Changes" needs several actions. **Sign-ins are never written to the audit log** (no LOGIN event on sign-in; the recovery DB has none) |
| Details: When (IST), Who, Action, Resource, Event ID, Trace ID, Browser/device | event fields | exists (`traceId` and `userAgent` often null) |
| "What changed" as Field / Before / After | `.diff` JSON (raw today; null on many events) | partial (a UI parser) |

Actions:
- **Refresh**. Exists.
- **Export all (CSV)**: `GET /v1/audit/events/export.csv`. Exists.
- **Details**. Exists.
- Keep today's filters (resource, who, record ID, dates).

**Permissions:**
- Registry: `page('audit', …, [any('audit.read')])`.
- Route: `RouteGuard anyOf=[P.AUDIT_READ]`.
- Backend: class-level `@PreAuthorize("hasAuthority('audit.read')")`; export requires `'audit.read'`.

**Gap:**
- Record sign-in events: web password, OTP, account portal, mobile; device and IP from the session.
- Allow an action list or category (`signins|changes|exports|permissions`) on list and export.

Size M. No schema change (`audit.events` is JPA-mapped by `AuditEvent`; no new column).

**Components:** PageHeader (+ Refresh, Export all), SegmentedControl, FilterPills (+ `DateField`), table card with Avatar, SidePanel (event details key-value + changes table), Skeleton, EmptyState, Toast.

---

## 12. My Workspace, PgWorkspace (legacy; `/me` gets EmpHome)

**What it is:** see §0. It is the prototype `me` module's "Overview". It is unreachable in the prototype, and superseded by EmpHome.

**Today:** `/me` and `/hrms/ess` → `EssDashboard.tsx`. Its blocks: greeting, date, Apply for leave, "This month" tiles (Present, Absent, Late, On time, Score), a leave panel, a "Requests and records" shortcut list, attendance history and time entries.

| Block / data point | Source | Status |
|---|---|---|
| Date/time eyebrow; "Good afternoon, <first name>" | clock; `greetingName(firstName, lastName)` | exists (keep the rule) |
| Sub-line: shift · checked in at · worked so far | `useTodayAttendance` → `GET /v1/attendance/today` + `GET /v1/shifts/employee/{id}` | exists |
| Tiles: Apply leave ("N casual days left"), Work from home, Add time entry, Change shift ("N pending" badge), Payslip ("<month> is ready"), My letters ("N letters") | `GET /v1/leave/my/balances`; `/me/wfh`; `GET /v1/ess/timesheets`; `GET /v1/shifts/change-requests/my`; `GET /v1/payroll/payslips/me`; letters `my` list | exists |
| This month: Present, Late, Absent, Attendance score | `useMonthlyStats` → `GET /v1/attendance/monthly-stats` | exists |
| This month: **On leave** (days) | not in `MonthlyStatsResponse` | partial |
| Today card: shift, hours, branch; status pill; progress within shift; Checked in (time, method, place); Left in shift | today + shift + employee record | exists |
| "Worked so far · Break 30 min included" | no breaks feature | missing (the "Take a break" gap in DECISIONS; self-service audit) |
| Leave balance rings (left of total) | `GET /v1/leave/my/balances` | exists |
| My requests (type, when, with whom, status) + **Withdraw** | leave `GET /v1/leave/my`, WFH `GET /v1/wfh/my`, shift `…/change-requests/my` | partial: no single feed; approver name not on every type; **no withdraw for shift-change requests** |
| Latest payslip: month, paid date, bank ••last4, net, gross, deductions; Annual CTC | `GET /v1/payroll/payslips/me(/{runId})`; `GET /v1/payroll/structures/me` | partial: bank last 4 not returned |
| Upcoming holidays | `GET /v1/settings/holidays` | exists |
| Finish onboarding checklist (N of M, tick items) | `GET /v1/onboarding/instances`, `/instances/{id}/tasks`, `POST /instance-tasks/{taskId}/complete` | exists (two calls) |

Actions:
- Apply leave: `POST /v1/leave/apply`. Exists.
- **Check out**: `POST /v1/attendance/checkout`. Exists.
- Add time entry: `POST /v1/ess/timesheets`. Exists.
- WFH, Change shift, Payslip view/PDF, Letters. Exist.
- Withdraw leave (`POST /v1/leave/{id}/cancel`) and WFH (`POST /v1/wfh/{id}/cancel`). Exist.
- Withdraw shift change. **Missing.**
- Tick onboarding task. Exists.

**Permissions:**
- Registry: `page('me', 'My workspace', '/me', …, [{ ...any('hrms.ess.read', 'attendance.checkin.self'), module: HR, self: true }])`.
- Route: `RouteGuard anyOf=[P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF]` + `ModuleGate hrms`.
- Rail: `if (group === 'ess' && administersWorkspace) return false` (OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN never see "Me").
- Shortcuts gated by `useAnyPermission` / `usePermission`: leave, WFH, shift, payslips (+ payroll module), salary, assets, interviews, letters.

**Gaps:**
- `leaveDays` in monthly stats. S.
- Shift-change withdraw `POST /v1/shifts/change-requests/{id}/cancel` (own pending only; `status` VARCHAR, no CHECK). S.
- Bank last 4 on payslips. S.
- Approver names on my requests. S.
- Breaks. M (self-service audit).

**Conflicts:**
- More → "My workspace" must follow the client's rule: admins → `/dashboard` (as the prototype does), everyone else → `/me`.
- My Attendance stays hidden for OWNER/ADMIN/SUPER_ADMIN (`notAdminRole` in the registry, the ESS group rule in the shell).

**Components (if built):** greeting row, QuickActionTile ×6, StatCard ×5, Card with ProgressBar, Ring, ListRow + StatusPill, payslip card, holiday date chips, checklist with ProgressBar, Toast.

---

## 13. Generic page frame, PgGeneric

**What it shows:** a module label, the title "<Page> · <Tab>", a fixed caption, 2 placeholder buttons, 4 empty stat-card skeletons and a table card of skeleton rows. There is **no data and no actions**. In the prototype it renders only for pages with no designed view (business-app pages marked `soon`).

**How to use it:**
- It is the layout contract (PageHeader → StatCard row → table card) for any page the design doesn't cover. Examples in or near this area:
  - Payroll configuration (`/hrms/payroll/components`, `/hrms/master/statutory`)
  - the public inspector view `/inspection` (no shell)
  - `/plan`
- Unbuilt business apps keep `ComingSoon` behind `ComingSoonRoute` (admins only: `roles.some(r => ADMIN_ROLES.includes(r))`; registry `SOON` entries `[{ when: planAdminOnly }]`), restyled with EmptyState.
- The caption "This page isn't designed yet" and the skeleton must never ship as a page.

---

## 14. All gaps (backend)

| # | Gap | Backend work | New table/column? | JPA-mapped table? | Size |
|---|---|---|---|---|---|
| 1 | Compliance summary counts | `GET /v1/compliance/summary` (POSH part behind `hrms.compliance.posh`) | No | reads JPA tables | S |
| 2 | Status filters on obligations and filings | `status` params, OVERDUE by due date | No | yes (read) | S |
| 3 | Filed date on Mark filed | `FileFilingRequest.filedDate` | No | yes (existing column) | S |
| 4 | Filing types LWF, TDS return 24Q | enum constants | No | yes (enum only) | S |
| 5 | POSH department | migration adds `posh_complaints.department_id`; JdbcTemplate read/write; hidden until applied | **Yes (column)** | **yes: must stay unmapped** | M |
| 6 | POSH Closed status | enum + transitions | No | yes (enum) | S |
| 7 | Inspection document shared date | select `created_at` | No | no (JDBC) | S |
| 8 | Policy summary for me | `GET /v1/policy/my-summary` | No | yes (read) | S |
| 9 | Policy audience count, owner name, "All" list | `PolicyResponse` fields + status=ALL | No | yes (read) | S |
| 10 | Probation reminder recipients | map `notified_user_ids` | No | no (JDBC log) | S |
| 11 | Templates channel filter + counts | params + summary | No | yes (read) | S |
| 12 | Integrations counts + "Needs attention" | summary + status endpoint | No | yes (existing column) | S |
| 13 | Headcount trend for headcount readers | `GET /v1/reports/headcount/trend` | No | n/a (SQL) | S |
| 14 | Password last changed | field on `/v1/me/security` | No | yes (existing column) | S |
| 15 | Session location | IP-to-location on read | No | n/a | M |
| 16 | Invoices + payment method | Razorpay API; optional JDBC table | No (live) | no | M |
| 17 | Workspace integrations (Slack, Teams, Google) | OAuth + tokens table + permission (grant to OWNER/SUPER_ADMIN) + adapters | **Yes (table)** | no (JDBC only) | L |
| 18 | Role grant date/by | `grantedAt/grantedBy` in `/v1/workspace/users` | No | yes (`UserRole`, existing columns) | S |
| 19 | Invite message | optional field + email placeholder | No | n/a | S |
| 20 | Module access switch | existing grant/revoke; default role per module | No | n/a | S |
| 21 | Role counts | `permissionCount`, `holderCount` | No | yes (read) | S |
| 22 | Audit sign-ins + categories | LOGIN events at sign-in; action list filter | No | yes (`AuditEvent`, no new column) | M |
| 23 | Monthly stats leave days | `leaveDays` | No | read | S |
| 24 | Shift-change withdraw | `POST …/change-requests/{id}/cancel` | No | existing VARCHAR | S |
| 25 | Payslip bank last 4, approver names on my requests | response fields | No | read | S |
| 26 | Breaks ("Take a break") | self-service audit owns it | Yes (table, JDBC) | no | M |

---

## 15. Conflicts with today's behaviour and client decisions

1. **Settings entry (26 Sep decision).** The design removes the header gear and the profile menu; settings open from More → Preferences, and settings pages light "More". 26 Sep kept "the header gear and the profile menu as before", and `railLit`/`live-rail-highlight.mjs` expect the gear to light on settings pages.
2. **Settings grouping.**
   - Design: one Settings page with 8 tabs (incl. Document types; Profile = workspace profile) + separate Users / Roles / Audit pages.
   - Today: one 10-item tab row, Profile → `/profile`, and no Document types.
   - All URLs can be kept.
3. **Settings in their own sections: the design agrees**, with one hole: Payroll configuration (salary components, statutory settings) has no page in the design's Workforce module, yet 26 Sep says Master keeps it (cross-area).
4. **Rules & policies:**
   - One page for everyone (admins gain "Policies"); Leave rules read-only in the design vs editable today.
   - Master's generated Rules pages must move out of `MasterContainer`.
5. **POSH:** the design has a "Closed" status after "Resolved" and a department per case. Today Resolved and Dismissed are final and there is no department.
6. **Mark filed:** the design picks a filed date; the server records today on purpose. Allowed if filed date ≤ today and LATE is computed from it.
7. **Company pickers** (Compliance, HR configuration, Templates, Integrations, Rules, Analytics): the design has none. Keep them in the header for multi-company tenants.
8. **SettingsKit behaviour** (section list, unsaved-changes bar, error jump, leave guard, view-only notice): the design shows only a Save button. Keep the behaviour, restyled.
9. **Features the design doesn't show but that must stay:**
   - inspector "Get link"
   - integration "Remove"
   - SMS templates and "Not used"
   - policy Remind, delete draft, acknowledgement list, publish options
   - permission overrides in Manage access
   - edit/delete role
   - audit filters (resource, who, record ID, dates)
   - Workforce analytics CSV/PNG/PDF and drill-down
10. **Calendar rule:** FilingCalendar (custom Sunday-first grid) and the inspector "Access ends" `datetime-local` must move to `src/shared/components/calendar`. The design grid is Monday-first, as is the shared `DayGrid`.
11. **My workspace:** More → "My workspace" goes to `/dashboard` for OWNER/SUPER_ADMIN/COMPANY_ADMIN/ADMIN (ESS hidden for them, My Attendance hidden) and to `/me` for everyone else.
12. **Greeting:** any greeting in this area uses `greetingName()` (first name; full name when the first name has fewer than 2 letters).
13. **Companies restore / Inactive view:** no conflict here. Pickers use `useCompanies()` (active companies), so archived companies drop out as today.
14. **Left-rail highlight (`railLit.ts`):**
    - `/hrms/policies` belongs to Master ("Rules & Policies" `also`). Keep "the item you came through stays lit".
    - Settings: see item 1.

---

## 16. Tests at risk

**Live tests (`apps/platform/e2e/recovery/`):**
- `live-settings-restored.mjs`: compares rail, gear, profile menu, Apps page, settings tab rows and section bars with the pre-26-Sep build **exactly**. It will fail by design once the shell changes, and must be rewritten to check the same addresses, page headings and permission visibility.
- `live-rail-highlight.mjs`: "Settings pages light what they lit before 26 Sep (the header gear, HR Setup, Master, Payroll)".
- `live-design-settings.mjs`: headings per `/settings/:tab`; "On this page" navigation; "Unsaved changes" region; "1 change · not saved yet"; `/profile#st-…`.
- `live-design-hrconfig.mjs`:
  - heading "HR Configuration", "On this page", "Unsaved changes", "2 changes · not saved yet"
  - "Use 1–10 letters or digits"
  - `/work-time` opens "Work week"
- `live-compliance-modals.mjs`:
  - heading "Statutory compliance", `[aria-label="Compliance views"]`
  - "Add obligation" / "Schedule filing" drawers and their labels (Obligation, Due date, Owner, Period, Filing type, Amount (₹))
  - "Mark filed" dialog "Challan / acknowledgement reference"
  - toasts "Filing scheduled"
- `live-inspector-browser.mjs`: `[aria-label="Compliance views"]`, link, public view, revoke.
- `live-design-access.mjs`: `[aria-label="User filters"]`, `[aria-label="Role views"]`, table rows, grant/remove role in the drawer, audit day filter, CSV.
- `live-design-hrsetup.mjs`:
  - Policies h1 "Policies" for the employee, `button[aria-expanded]` policy cards
  - template drawer add/edit/delete
  - integrations add/mark/remove
- `live-design-master.mjs`:
  - `/hrms/master/shift-rules` "Shift Rules", `/leave-rules` "Leave Rules", `/hrms/policies` "Policy Documents"
  - toasts "<tag> Shift shift added", "Policy saved as draft"
- `live-design-reports.mjs`: Workforce Analytics page and PDF.
- `live-dead-entrypoints.mjs`: `/me` buttons `/^Salary.*View/`, `/Apply for leave/`, Onboarding Tasks shortcut; `/hrms/settings` and `/work-time`.
- `live-w3-greeting-myatt.mjs`: the greeting rule and no My Attendance for owner/admin (must keep passing).
- API-only, low risk: `live-w2g.mjs`, `live-w1h.mjs`, `live-w1c.mjs`, `live-inspection-documents.mjs`, `live-compliance-reports.mjs`.

**Playwright (`apps/platform/e2e/tests/`):**
- `super-admin/09-workspace.spec.ts`: heading `/workspace users/`, `getByRole('tab', {name:'Roles'})`, "audit logs" heading. It already looks stale.
- `hr-manager/09-restrictions.spec.ts`, `dept-manager/06-restrictions.spec.ts`, `employee/08-restrictions.spec.ts`: "Access Restricted" text on `/users`, `/roles`, `/audit-logs`. Keep the RouteGuard wording.
- `live/pages-sweep.spec.ts`, `live/prod-sweep.spec.ts`: they visit every page.

**Unit tests:** `src/shared/navigation/pageRegistry.test.ts` (new tabs/pages need registry entries), `src/layouts/railLit.test.ts`, `src/shared/hooks/greetingName.test.ts`, `src/modules/hrms/compliance/inspectorCsv.test.ts`.

---

## 17. Risks

- **Dark mode needs a token pass.** These files hard-code light colours:

  | File | Hex values |
  |---|---|
  | `design/dc/WorkforceAnalytics.view.tsx` | 121 |
  | `design/settings/SettingsKit.tsx` | 79 |
  | `design/module/ModuleKit.tsx` | 41 |
  | `HrConfigurationPage.tsx` | 21 |
  | `BrandingTab.tsx` | 20 |
  | `SettingsSecurity.tsx` | 16 |
  | `FilingCalendar.tsx` | 11 |

- **Generated views.** WorkforceAnalytics (design-build) and Master's Rules pages (`MasterDesign.tsx` via `MasterContainer`) are generated from old exports. Replacing them needs routing changes and removal from the build scripts, coordinated with the Org/Master and Reports audits.
- **Pre-existing bugs not to carry over:**
  - The `Policies.tsx` Shift Rules tab is gated on `attendance.regularization.approve` but `/v1/shifts` writes need `attendance.workforce.admin` (a manager could see Save and get a 403).
  - The gear shows for everyone but `/settings` refuses employees.
  - Compliance, templates, integrations and policy tiles count one page only.
  - FilingCalendar uses the browser date and a Sunday-first grid.
  - `LeaveService.isWeekend` hard-codes Saturday/Sunday while HR configuration lets you change the week (docs §8).
- **Production DB:**
  - The POSH department column must stay unmapped in JPA and be hidden until the hand-applied migration exists.
  - A workspace-integrations table and permission must grant OWNER + SUPER_ADMIN (OwnerPermissionInvariantCheck).
  - Enum additions (LWF, TDS return, CLOSED) are code-only, but an older app instance can't read the new values during a rolling deploy.
- **Can't test locally:** billing (`/v1/workspace/plan/current` returns 403 for the demo owner) and any Razorpay/OAuth work.
- **Sensitive data:** POSH counts and department must stay behind `hrms.compliance.posh`. The public inspector view must stay token-scoped.
- **Deep links:** keep `?view=` on compliance, roles and policies and `/settings/:tab`. The new Workforce analytics tabs need a URL param + registry tab entries. Keep all `MovedTo` hub addresses (`/hrms/settings/*`, `/settings/integrations/register`).
- **Overlaps with other audits:** m-rules ↔ PgTime (`a-shifts`), PgLeave (Leave types), EmpDocs (`e-pol`); `/me` ↔ EmpHome; `r-wfa` ↔ Reports; `cp-muster` ↔ PgTime; Payroll configuration ↔ Org/Payroll.

---

## 18. Open questions

1. **POSH:**
   - Add a separate **"Closed"** status after "Resolved", as the design shows? Today Resolved and Dismissed are final.
   - Record a **department** on each complaint? That needs a new DB column.
2. **Settings entry:**
   - The design has no header gear or profile menu (Settings only via More → Preferences). On 26 Sep you kept both "as before". Keep a gear in the new top bar, or follow the design?
   - Also: the Settings tab row as 8 tabs + separate Users / Roles / Audit pages (design), or today's single 10-item row?
3. **Rules & policies → Leave rules:** the design makes it read-only with a link to Leave › Leave types. Today you can edit leave types there. Make it read-only?
4. **Workspace Settings → Integrations:** the design shows real Slack, Google Workspace sign-in and Microsoft Teams connections. Each needs an app registered with the provider and its secrets. Build them now, or keep "Coming soon" until you have the credentials?
5. **Billing → Invoices:** build from Razorpay's invoice API? It needs live keys and can't be tested locally.
6. **Users → Manage access "Module access" switches:**
   - Should switching a module on give that module's default role?
   - Should switching it off remove all of that person's roles in the module?
7. **Security → sessions "Where" (city):** add an IP-to-location database (e.g. GeoLite2), or show the IP address instead?
8. **Payroll configuration** (salary components, statutory settings) has no page in the design. Keep it as a Workforce (Master) page as decided on 26 Sep?
