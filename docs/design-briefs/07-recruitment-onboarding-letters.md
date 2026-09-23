# Recruitment, Onboarding, Letters & Employee Vault — page briefs

This group covers the hire-to-day-one flow plus the paperwork that surrounds it: job requisitions and candidate pipeline, offer drafts, the new-hire wizard, onboarding checklists and asset allocation, letter templates/generation/bulk distribution, and the per-employee document vault.
Sidebar group: **Recruitment & Onboarding** (`layouts/PlatformShell.tsx`, key `recruit`) with six leaves — Hiring Pipeline, Onboarding & Assets, Letter Templates, Generated Letters, Letter Distributions, Employee Vault. The Templates pages (`/hrms/onboarding`, `/hrms/onboarding/templates/:id`) and the wizard (`/hrms/onboarding/instances/new`) have no sidebar entry and are reached from inside these pages.
Roles: every leaf is `visibleForRoles: R_HR` = **OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER**; some leaves also appear for any custom role holding a listed permission (`visibleWithAnyPermission`). Routes are additionally guarded by `RouteGuard anyOf=[…]` permission codes noted per page. All screens sit inside `ModuleGate moduleKey="hrms"`. Source paths below are relative to `apps/platform/src/`.

Design-system vocabulary is from `.design-sync/conventions.md`: `HrPageHeader`, `HrStatCard`, `HrStatusPill`, `HrButton`, `HrAvatar`, `HrTabs`/`HrTabPanel`, `HrDrawer`, `TableCard`, `DataTable`, `HrPagination`, `EmptyState`, `Modal`, `Button`, `Field`/`Input`, `TableSkeleton`, `CardSkeleton`.

---

## Hiring Center  `/hrms/hiring`
- **File:** `modules/hrms/Hiring.tsx` (+ `modules/hrms/hiring/OffersTab.tsx`, hooks `modules/hrms/api/useHiring.ts`)  ·  **Sidebar:** Recruitment & Onboarding › Hiring Pipeline  ·  **Roles:** R_HR (OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER) or any role with `hrms.hiring.offer.read`; route guard `anyOf ['hrms.hiring.read','hrms.hiring.write','hrms.hiring.candidate.write','hrms.hiring.offer.read']`
- **Status:** LIVE — all three tabs call real hooks: `useRequisitions → GET /v1/hiring/requisitions?page=0&size=20`, `useCandidates → GET /v1/hiring/requisitions/{id}/candidates`, `useHiringOffers → GET /v1/hiring/offers?page&size=20`.

### Purpose
HR opens job requisitions, adds candidates against a requisition and moves them through Applied → Screening → Interview → Offer → Hired/Rejected, then drafts, emails and tracks offer letters. Used by HR managers and company admins; a custom "offer reader" role can see only the Offer Management tab.

### Layout
1. `HrPageHeader` — crumb "Recruitment", title "Hiring Center", subtitle "Open requisitions and move candidates through the pipeline". No header actions.
2. `HrTabs` — **Requisitions** (needs `hrms.hiring.read`), **Pipeline** (needs `hrms.hiring.read`), **Offer Management** (needs `hrms.hiring.read` or `hrms.hiring.offer.read`). Tabs the user cannot see are removed, not disabled.

#### Tab: Requisitions (`RequisitionsTab`)
3. KPI strip of 4 `HrStatCard` (computed client-side from the page-0 list): **Requisitions** (count, blue) · **Open** (status OPEN, green) · **Open Positions** (sum of `openings` where status ≠ CLOSED, orange) · **Closed** (teal). All show skeleton while loading.
4. Inline create card (`ut-card`, only when `hrms.hiring.write`): fields **Job title** (placeholder "e.g. Senior Backend Engineer"), **Openings** (number, min 1, default 1), **Location** ("e.g. Bengaluru"), **Type** (select: Full Time / Part Time / Contract / Intern / Temporary — from `EMPLOYMENT_TYPES` in `useHiring.ts`), primary `HrButton` "+ Open Requisition".
5. `TableCard` > `hr-table` columns: **Title** (title + location as sub-line) → `title`,`location` · **Type** → `employmentType` (Title-cased) · **Openings** → `openings` · **Candidates** → `candidateCount` · **Status** → `HrStatusPill` OPEN=ok "Open", ON_HOLD=warn "On Hold", CLOSED=gray "Closed" · **Opened** (hidden < sm) → `createdAt` as `d MMM yyyy` · **Actions** (only with write): ghost `HrButton size=sm` "Edit" (pencil) and "Close" (x-circle, hidden when CLOSED).
6. `HrDrawer` **"Edit Requisition"** — opens on Edit; re-fetches `useRequisition(id) → GET /v1/hiring/requisitions/{id}`. Body: read-only summary strip (status pill, "N candidates · Hiring manager: {hiringManagerName} · Opened d MMM yyyy"), then **Job title *** , **Openings** / **Type** (select incl. "Not set" + any unknown server value), **Location**, **Description** (textarea rows=5, placeholder "Responsibilities, must-have skills, interview loop…"). Footer: ghost "Cancel", primary "Save Changes" / "Saving…".

#### Tab: Pipeline (`PipelineTab`)
7. Toolbar row: label "Requisition" + `select` of all requisitions ("{title} ({Status})"; defaults to first non-closed; single option "No requisitions" when the list is empty), and an `HrStatusPill` "N opening(s)" for the selected one.
8. Inline add-candidate card (only when `hrms.hiring.candidate.write` AND selected requisition not CLOSED): **Full name** ("e.g. Priya Sharma"), **Email** (optional), **Source** ("e.g. LinkedIn"), **Expected CTC (₹)** (number), primary `HrButton` "+ Add Candidate".
9. `TableCard` > `hr-table`: **Candidate** → `HrAvatar name=fullName sub=email` · **Source** → `source` · **Expected CTC** → `inr(expectedCtc)` (₹ en-IN) · **Stage** → `HrStatusPill` APPLIED=gray, SCREENING=info, INTERVIEW=purple, OFFER=warn, HIRED=green, REJECTED=red · **Advance** (only with candidate.write) → inline `select` of all six stages (aria "Advance candidate stage").

#### Tab: Offer Management (`OffersTab`)
10. Intro row: text "Track offer drafts, issue status and candidate decisions." + primary `HrButton` "Create offer" (toggles to "Cancel"; only when `hrms.hiring.offer.write` or `hrms.hiring.write`).
11. Inline **Email offer** card (appears when a row's "Email offer" is clicked): heading "Email offer to {candidateName}", helper "The message includes the saved offer terms and PDF. Sending freezes the draft. Mail-service acceptance does not confirm inbox delivery.", field **Candidate email** (required, maxLength 254), buttons "Send offer email"/"Submitting..." and ghost "Cancel email"; inline `role=alert` on failure: "The email could not be confirmed. Check your mail provider before retrying to avoid a duplicate message."
12. Inline **Create / Edit offer** form card (2-col): **Company** (select, required, disabled when editing), **Candidate name** (required, max 200), **Role** (required, max 200), **Annual offered CTC (INR)** (number, min 0, step 0.01, required), **Joining date** (date), **Internal notes** (textarea max 10000), **Offer terms (included in PDF)** (textarea rows 6, max 20000, helper "Enter the approved candidate-facing terms. Internal notes are never included in the document."), submit "Save draft"/"Saving...". Inline alert "Companies could not be loaded. Retry".
13. `TableCard` > `hr-table`: **Candidate** (name + notes sub-text) · **Role** → `roleTitle` · **Offered CTC** → `inr(offeredCtc)` · **Joining date** → `joiningDate` or "Not set" · **Status** → `HrStatusPill` ACCEPTED=green, DECLINED=red, else gray; raw enum text (DRAFT/SENT/ACCEPTED/DECLINED/WITHDRAWN) · **Document** → ghost "Download PDF"/"Preparing..." + either "Submitted to {emailRecipient} <br> {emailSubmittedAt localeString}" or ghost "Email offer" (DRAFT/SENT only, write only) · **Update status** (write only) → ghost "Edit draft" (DRAFT only) + `select` "Choose action" with next statuses (DRAFT→"Mark as sent"/WITHDRAWN; SENT→ACCEPTED/DECLINED/WITHDRAWN) or text "Final decision".
14. `HrPagination` page size 20 under the table.

### Data shown
- Requisitions list + KPIs: `useRequisitions(0) → GET /v1/hiring/requisitions?page=0&size=20` (fields id, title, location, employmentType, openings, candidateCount, status, createdAt, companyId, departmentId, hiringManagerId, hiringManagerName, description). Only page 0 is ever fetched — no pagination UI.
- Edit drawer: `useRequisition(id) → GET /v1/hiring/requisitions/{id}`.
- Companies for create: `useCompanies → /v1/hrms/companies` (first company used).
- Candidates: `useCandidates(requisitionId) → GET /v1/hiring/requisitions/{id}/candidates` (fullName, email, source, expectedCtc, stage).
- Offers: `useHiringOffers(page) → GET /v1/hiring/offers?page={p}&size=20` (candidateName, roleTitle, offeredCtc, joiningDate, status, notes, offerTerms, emailRecipient, emailSubmittedAt, companyId, candidateId, requisitionId).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Requisitions / Pipeline / Offer Management | HrTabs | switch tab | read / read / read or offer.read | LIVE |
| Open Requisition | Requisitions create card | `useCreateRequisition → POST /v1/hiring/requisitions` {companyId: first company, title, openings, location, employmentType}; toast "Requisition opened"; form clears | hrms.hiring.write | LIVE |
| Edit | row | opens HrDrawer "Edit Requisition" (fetches record) | hrms.hiring.write | LIVE |
| Close | row (non-CLOSED) | `useCloseRequisition → POST /v1/hiring/requisitions/{id}/close`; toast "Requisition closed"; no confirm | hrms.hiring.write | LIVE |
| Save Changes | drawer footer | `useUpdateRequisition → PUT /v1/hiring/requisitions/{id}` (full replace; echoes companyId/departmentId/hiringManagerId); toast "Requisition updated" | hrms.hiring.write | LIVE |
| Cancel | drawer footer | closes drawer, resets form | — | LIVE |
| Requisition select | Pipeline toolbar | changes `useCandidates` key | hrms.hiring.read | LIVE |
| Add Candidate | Pipeline card | `useAddCandidate → POST /v1/hiring/requisitions/{id}/candidates` {fullName, email?, source?, expectedCtc?}; toast "Candidate added" | hrms.hiring.candidate.write; requisition not CLOSED | LIVE |
| Advance stage select | Pipeline row | `useUpdateCandidateStage → PUT /v1/hiring/candidates/{id}/stage` {stage}; toast "Stage updated"; select disabled while a change is pending | hrms.hiring.candidate.write | LIVE |
| Create offer / Cancel | Offers intro | toggles inline create form, clears editing state | offer.write or hiring.write | LIVE |
| Save draft | Offers form | create: `POST /v1/hiring/offers`; edit: `useEditHiringOffer → PUT /v1/hiring/offers/{id}` (carries candidateId/requisitionId); toast "Offer draft created/updated"; page resets to 0 | offer.write or hiring.write | LIVE |
| Retry (companies) | Offers form alert | `companies.refetch()` | — | LIVE |
| Download PDF | Offers row | `downloadOfferPdf → GET /v1/hiring/offers/{id}/pdf` (blob → anchor download as `offer-{id}.pdf`); every row's button is disabled while one download is in flight | anyone on tab | LIVE |
| Email offer | Offers row (DRAFT/SENT, not yet submitted) | opens Email offer card | offer.write or hiring.write | LIVE |
| Send offer email | Email card | `useEmailHiringOffer → POST /v1/hiring/offers/{id}/email` {recipient}; toast "Offer accepted by the mail service" | offer.write or hiring.write | LIVE (local SMTP only verified) |
| Cancel email | Email card | closes card | — | LIVE |
| Edit draft | Offers row (DRAFT) | prefill + open form (Company disabled) | write | LIVE |
| Choose action select | Offers row (aria "Update offer for {candidateName}") | `useUpdateHiringOfferStatus → POST /v1/hiring/offers/{id}/status` {status}; toast "Offer status updated" | write | LIVE |
| Retry (offers) | Offers error card | `query.refetch()` | — | LIVE |
| HrPagination | Offers footer | page state → refetch | — | LIVE |

### States
- Loading: KPI skeletons; requisitions/candidates tables show 3–4 pulse rows; offers table single cell "Loading offers...".
- Empty: requisitions "No requisitions yet / Open your first requisition to start hiring."; pipeline with no selection "Pick a requisition to view its pipeline."; no candidates "No candidates yet / Add candidates to start the pipeline."; offers "No offers yet. Create a draft to begin tracking an offer."
- Error: offers tab renders `ut-card role=alert` with message + "Retry"; requisitions/pipeline tabs have **no error state** (silent).
- Drawer: skeleton while loading; "This requisition could not be loaded. Close and try again." when missing.
- Validation toasts (error): "Give the requisition a title" (create and Save Changes), "Pick a requisition first" / "Candidate name is required" (Add Candidate); mutation failures toast the server message.
- No permission: tabs are removed; RouteGuard blocks the route entirely if none of the four codes.
- Special: add-candidate form hidden when requisition CLOSED; offers in ACCEPTED/DECLINED/WITHDRAWN show "Final decision"; after email submit the row shows "Submitted to …" permanently.

### Rules & permissions
- `hrms.hiring.read` → Requisitions + Pipeline; `hrms.hiring.write` → create/edit/close requisition, also counts as offer write; `hrms.hiring.candidate.write` → add/advance candidate; `hrms.hiring.offer.read` → Offer tab only; `hrms.hiring.offer.write` → offer CRUD/email/status.
- Requisition create always uses `companies[0].id`; title required; openings clamped ≥1. PUT is a full replace (backend nulls omitted fields) — drawer echoes non-editable ids. Edit allowed on CLOSED rows.
- Offer lifecycle (frontend `nextStatuses`): DRAFT→SENT|WITHDRAWN; SENT→ACCEPTED|DECLINED|WITHDRAWN; terminal states have no actions. Only DRAFT is editable. Company can't change on edit. Backend: new offers must start DRAFT; linked offers restrict recipient to candidate's recorded email; approved terms required to email; repeated same-recipient requests return saved result (HRMS_IMPLEMENTATION_STATUS "Offer delivery").
- Candidate expected CTC and offered CTC formatted `inr()` → ₹12,00,000.

### Gaps & plan
- **Keep:** the three-tab structure, KPI strip, inline create cards, stage select, offer lifecycle select, PDF/email row actions, honest "Mail-service acceptance does not confirm inbox delivery" copy.
- **Add:**
  - [BLUEPRINT §13 / PLAN §10] Interview entity (schedule/reschedule/cancel), Feedback (rating + recommendation), Requisition approval — all ❌ today; no UI exists.
  - [BLUEPRINT §13, PLAN §10] **Candidate → Employee conversion** `POST /v1/hiring/candidates/{id}/convert` — "If only one is built, build conversion." Today HIRED candidates dead-end; HR retypes them in the onboarding wizard.
  - [BLUEPRINT §7 target IA] split leaves "Requisitions & Candidates / Interviews / Offers" under a Hiring group; [BLUEPRINT §8.3 drill-down map] dashboard drill-downs `/hrms/hiring?status=OPEN` and `?tab=candidates` (not honoured by the page — no URL tab/status param support in `Hiring.tsx`).
  - [HANDOFF §10 C; STATUS "Important limits still open"; AUDIT "Remaining acceptance and product gaps"] harden offer email delivery (outbox/idempotency, provider callbacks, bounces) — real provider delivery, signatures and inbox receipts are unverified; only local SMTP capture is proven.
  - [code: Hiring.tsx] requisitions list fetches only page 0 with no pagination control; add `HrPagination`.
  - [code: OffersTab] offers are not linked to pipeline candidates from the UI (candidateId/requisitionId only echoed on edit; create form has free-text candidate name).
- **Change:**
  - Requisitions and Pipeline tabs have no error/retry state (offers tab does) — inconsistent.
  - "Close" requisition has no confirm; "Advance stage" select changes stage immediately with no confirm or undo.
  - Offer status pill shows raw enum (DRAFT/SENT) while requisitions/candidates use Title Case — normalise.
  - Offer forms are inline cards that push the table down; move Create/Edit offer and Email offer into `HrDrawer` for consistency with Edit Requisition.
  - Joining date renders raw ISO ("2026-09-18") — format `18 Sep 2026`.
  - Email offer submitted timestamp uses `toLocaleString()` — inconsistent with `d MMM yyyy` elsewhere.

### Screenshot
`Attach: /hrms/hiring — current screen`

### Claude Design prompt (ready to paste)
```
Design the Hiring Center page (/hrms/hiring) for HR_MANAGER / COMPANY_ADMIN. HrPageHeader crumb "Recruitment", title "Hiring Center", subtitle "Open requisitions and move candidates through the pipeline"; HrTabs: Requisitions · Pipeline · Offer Management.
Requisitions tab: KPI strip of 4 HrStatCard — Requisitions 12 · Open 7 · Open Positions 19 · Closed 5. Header action "+ Open Requisition" opens an HrDrawer (Job title "e.g. Senior Backend Engineer", Openings, Location "e.g. Bengaluru", Type select Full Time/Part Time/Contract/Intern/Temporary, Description "Responsibilities, must-have skills, interview loop…") instead of today's inline card. TableCard columns: Title (with location sub-line "Bengaluru"), Type, Openings, Candidates, Status (HrStatusPill Open=ok / On Hold=warn / Closed=gray), Opened "18 Sep 2026", row actions ghost "Edit" (opens HrDrawer "Edit Requisition" with a read-only strip "4 candidates · Hiring manager: Anita Rao · Opened 3 Aug 2026") and "Close" (add a confirm Modal). Add HrPagination footer.
Pipeline tab: toolbar with Requisition select "Senior Backend Engineer (Open)" + pill "3 openings"; "+ Add Candidate" (Full name, Email, Source, Expected CTC ₹). TableCard: Candidate (HrAvatar "Priya Sharma" / priya@…), Source "LinkedIn", Expected CTC ₹18,00,000, Stage pill (Applied gray · Screening info · Interview purple · Offer warn · Hired green · Rejected red), Advance = stage select.
Offer Management tab: "Create offer" opens HrDrawer (Company, Candidate name, Role, Annual offered CTC (INR), Joining date, Internal notes, Offer terms textarea with helper "Internal notes are never included in the document"). TableCard: Candidate, Role, Offered CTC ₹14,50,000, Joining date "1 Oct 2026", Status pill Draft/Sent/Accepted/Declined/Withdrawn in Title Case, Document (ghost "Download PDF" + "Email offer" or "Submitted to a@b.com · 12 Sep 2026, 14:05"), Update status select "Choose action". HrPagination page size 20.
States: loading skeletons; empty "No requisitions yet — Open your first requisition to start hiring." / "No candidates yet" / "No offers yet. Create a draft to begin tracking an offer."; error card with Retry on every tab.
Keep the honest email copy: "Mail-service acceptance does not confirm inbox delivery." Add (future, show as disabled/coming-soon): "Convert to employee" row action on Hired candidates, Interviews sub-tab.
```

---

## Onboarding & Assets  `/hrms/onboarding/instances`
- **File:** `modules/hrms/onboarding/Instances.tsx` (+ `AssetsTab.tsx`, `AssetHistory.tsx`, hooks `onboarding/api/useOnboarding.ts`, `onboarding/api/useAssets.ts`)  ·  **Sidebar:** Recruitment & Onboarding › Onboarding & Assets  ·  **Roles:** R_HR or any role with `hrms.onboarding.asset.read`; route guard `anyOf [HRMS_ONBOARDING_INSTANCE_READ, HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read']`
- **Status:** LIVE — `useInstances → GET /v1/onboarding/instances`, `useAssets → GET /v1/onboarding/assets`, `AssetHistory → GET /v1/onboarding/assets/{id}/history`; employee names via `useEmployeesByIds → /v1/hrms/employees/by-ids`.

### Purpose
HR's onboarding dashboard: see every new-hire onboarding run (In Progress / Completed / On Hold), start a new hire, put a run on hold or resume it, and jump into its checklist. The second tab is the company asset register: register laptops/devices, assign to an employee, record returns, and view allocation history.

### Layout
1. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Onboarding & Assets", subtitle "Manage new hire onboarding, create employee records, and track assets". No header actions (the Start button sits below the tabs, right-aligned).
2. `HrTabs` — **New Employee Onboarding** (needs `hrms.onboarding.instance.read`) · **Asset Allocation** (needs `hrms.onboarding.asset.read` or `instance.write`).

#### Tab: New Employee Onboarding
3. Right-aligned primary `HrButton` "+ Start Onboarding" (only `hrms.onboarding.instance.write`) → navigates to `/hrms/onboarding/instances/new`.
4. KPI strip of 4 `HrStatCard` (computed from the unfiltered list): **Total** (blue) · **In Progress** (purple) · **Completed** (green) · **On Hold** (orange).
5. `TableCard` with toolbar `actions` (only when list non-empty): status `select` "All Statuses / In Progress / Completed / On Hold" + text button "Clear filter" when active; footer pager "Showing 1–10 of 23", prev/next chevrons, "1 / 3" (client-side, PAGE_SIZE 10).
6. `hr-table` columns: **S.No** · **Employee Name** → `HrAvatar` from by-ids lookup (falls back to "Employee {first 6 chars of id}" while unresolved; "—" with title "Your role cannot read employee names" when `hrms.employee.read` is missing) · **Email** (hidden < md; "—" with title "Your role cannot read employee emails" when gated) · **Department** (hidden < lg, resolved via `useDepartments(companies[0])`) · **Joining Date** (hidden < sm) → `emp.dateOfJoining ?? instance.startedAt` as `dd MMM yyyy` · **Status** → `HrStatusPill` IN_PROGRESS=warn "In Progress", COMPLETED=ok "Completed", ON_HOLD=red "On Hold", other=gray raw · **Action** → ghost `HrButton size=sm` "View" + kebab `RowMenu` (custom, MoreVertical icon).
7. Row is clickable → `/hrms/onboarding/instances/{id}`.

#### Tab: Asset Allocation (`AssetsTab`)
8. Intro row: "Register equipment, assign it to employees and record returns." + primary `HrButton` "Register asset" (toggles "Cancel"; needs `asset.write` or `instance.write`).
9. Inline register form card (2-col): **Company** (select, required), **Asset tag** (required, max 80), **Category** (required, max 80), **Asset name** (required, max 200), **Serial number** (max 120), **Condition notes** (max 4000); "Save asset"/"Saving...". Inline alert "Unable to load companies. Retry".
10. Inline action card (when a row's Assign/Receive return clicked): heading "Assign asset: {assetTag}" with `PerformanceEmployeePicker` (company-scoped) and button "Confirm assignment"; or "Receive return: {assetTag}" with textarea **Condition on return** and button "Record return"; ghost "Cancel".
11. `TableCard` > `hr-table`: **Asset** (tag bold, name, serial) · **Category** → `assetType` · **Employee** → Link to `/hrms/employees/{id}` (name or "View employee"), "Assigned employee" (no directory read) or "Unassigned" · **Dates** → "Assigned: {assignedAt}" / "Returned: {returnedAt}" raw strings · **Status** → `HrStatusPill` ASSIGNED=info else green, raw enum, + conditionNotes · **Action** → ghost "Assign"/"Receive return" (write) + ghost "History".
12. **Asset History panel** (`AssetHistory.tsx`, `ut-card section` below the table): "Allocation history · {tag}", ghost "Close history"; ordered list of allocations — employeeName bold, "Assigned {assignedAt} · Returned {returnedAt}" or "Currently assigned", notes.

### Data shown
- Instances: `useInstances(undefined, canReadInstances) → GET /v1/onboarding/instances` (id, employeeId, templateId, status, startedAt, completedAt, `instanceTasks[]` — the DTO already carries the task list, but the page never reads it). Filter and paging are client-side.
- Employee names/emails/department/joining: `useEmployeesByIds(ids, {enabled: hrms.employee.read})`; departments `useDepartments(companies[0].id)`.
- Assets: `useAssets(enabled) → GET /v1/onboarding/assets` (companyId, employeeId, assetTag, assetType, assetName, serialNo, status, assignedAt, returnedAt, conditionNotes).
- History: `GET /v1/onboarding/assets/{assetId}/history` (employeeName, assignedAt, returnedAt, notes).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| New Employee Onboarding / Asset Allocation | HrTabs | switch tab | instance.read / asset.read or instance.write | LIVE |
| Start Onboarding | above KPIs (and in empty state) | `navigate('/hrms/onboarding/instances/new')` | hrms.onboarding.instance.write | LIVE |
| Status filter select | TableCard toolbar | client-side filter, resets page to 0 | — | LIVE |
| Clear filter | toolbar / filtered empty state | resets status filter | — | LIVE |
| Prev / Next page | TableCard footer | client paging (10/page) | — | LIVE |
| Row click / View | row | `navigate('/hrms/onboarding/instances/{id}')` | — | LIVE |
| View onboarding | kebab | same as View | — | LIVE |
| Put on hold | kebab (IN_PROGRESS) | `useUpdateInstanceStatus → PATCH /v1/onboarding/instances/{id}/status` {status:'ON_HOLD'}; toast "Onboarding put on hold" | instance.write | LIVE |
| Resume onboarding | kebab (ON_HOLD) | PATCH status IN_PROGRESS; toast "Onboarding resumed" | instance.write | LIVE |
| Reopen onboarding | kebab (COMPLETED) | PATCH status IN_PROGRESS; toast "Onboarding reopened" | instance.write | LIVE |
| Open employee profile | kebab (only once the by-ids lookup resolved the employee) | `navigate('/hrms/employees/{empId}')` | hrms.employee.read | LIVE |
| Open template | kebab | `navigate('/hrms/onboarding/templates/{templateId}')` | hrms.onboarding.template.read | LIVE |
| Retry | error EmptyState | `refetch()` | — | LIVE |
| Register asset / Cancel | Assets intro | toggles form | asset.write or instance.write | LIVE |
| Save asset | Assets form | `create → POST /v1/onboarding/assets`; toast "Asset registered" | asset.write or instance.write | LIVE |
| Retry (companies) | Assets form alert | refetch | — | LIVE |
| Assign | Assets row (any status other than ASSIGNED) | opens action card with employee picker; "Confirm assignment" disabled until an employee is picked | write | LIVE |
| Confirm assignment | action card | `assign → POST /v1/onboarding/assets/{id}/assign` {employeeId}; toast "Asset updated" | write | LIVE |
| Receive return | Assets row (ASSIGNED) | opens action card with condition textarea | write | LIVE |
| Record return | action card | `receive → POST /v1/onboarding/assets/{id}/return` {notes}; toast "Asset updated" | write | LIVE |
| Cancel | action card | closes | — | LIVE |
| History | Assets row | opens AssetHistory panel (fetch) | — | LIVE |
| Close history | history panel | closes | — | LIVE |
| Retry (history/assets) | error blocks | refetch | — | LIVE |
| Employee link | Assets row | `<Link to="/hrms/employees/{id}">` | hrms.employee.read | LIVE |

### States
- Loading: KPI skeletons + `TableSkeleton`; assets "Loading assets..."; history "Loading history...".
- Empty (first-run): "No onboarding instances yet" — "Use “Start Onboarding” to create a new hire record and generate their checklist." (write) / "Onboarding runs started by HR will appear here." (read-only), primary action Start Onboarding.
- Empty (filtered): "No onboarding runs with this status" — "Nothing matches the status filter. Clear it to see every onboarding run." + "Clear filter".
- Error: `EmptyState variant=error` "Failed to load instances" rendered inside the table body, Retry. Assets: `ut-card role=alert` + Retry.
- No permission: Assets tab → "You do not have access to asset records."; name/email cells show "—" with tooltip when `hrms.employee.read` missing.
- Assets empty: "No assets registered."; history empty: "No allocation history yet."

### Rules & permissions
- Instance read (`hrms.onboarding.instance.read`) deliberately does **not** expose asset inventory; assets need `hrms.onboarding.asset.read` or `instance.write` (HANDOFF §5 "Important permission decision").
- Hold/Resume/Reopen need `hrms.onboarding.instance.write` (same as Start). IN_PROGRESS→COMPLETED happens automatically when the last task is completed; ON_HOLD only via this menu.
- Stats always count the full unfiltered list; filter is client-side so cards stay truthful.
- Assets: tag/category/name required; backend rejects duplicate assignments, wrong-company employees, invalid dates (HANDOFF §5 "Assets and onboarding").

### Gaps & plan
- **Keep:** KPI strip, filter/clear, kebab with contextual hold/resume/reopen, honest "—" for gated lookups, allocation history panel.
- **Add:**
  - [BLUEPRINT §14 / PLAN §11] "Add: progress on dashboard, reminders, reassignment" — no task reminders or owner reassignment exist.
  - [code: Instances.tsx] no search by employee name; no progress (x of y tasks) column — the list can't show how far each run is without opening it, even though `instanceTasks[]` is already on the instance DTO (`useOnboarding.ts`).
  - [BLUEPRINT §14 / §6 row 23] still lists Asset Allocation as "Class D — no backend; defer to P2"; the register/assign/return/history flow now exists (HANDOFF §5 "Assets and onboarding") — the blueprint entry is stale, not a gap.
  - [code: AssetsTab] no search/filter on assets; assets table shows raw dates and raw status enum.
  - [HANDOFF §12] "Old overwritten asset histories cannot be reconstructed" — history before V136 is partial; label first history entry as backfilled.
- **Change:**
  - Move "Start Onboarding" into `HrPageHeader actions` (currently a lone right-aligned button under the tabs).
  - Asset register / assign / return use inline cards that reflow the page — use `HrDrawer` ("Register asset", "Assign {tag}", "Receive return · {tag}") and render History in an `HrDrawer` too.
  - Assets table: Employee cell shows "View employee" when the by-ids lookup hasn't resolved; Dates cell concatenates raw ISO strings — format `18 Sep 2026`; status pill shows "ASSIGNED"/"AVAILABLE" enum.
  - `RowMenu` is a hand-rolled kebab; use the DS row-action pattern.

### Screenshot
`Attach: /hrms/onboarding/instances — current screen`

### Claude Design prompt (ready to paste)
```
Design the Onboarding & Assets page (/hrms/onboarding/instances) for HR_MANAGER / COMPANY_ADMIN. HrPageHeader crumb "Recruitment & Onboarding", title "Onboarding & Assets", subtitle "Manage new hire onboarding, create employee records, and track assets", header action primary HrButton "+ Start Onboarding"; HrTabs "New Employee Onboarding" · "Asset Allocation".
Onboarding tab: KPI strip of 4 HrStatCard — Total 23 · In Progress 9 · Completed 12 · On Hold 2. TableCard toolbar: status FilterBar (All Statuses / In Progress / Completed / On Hold) + "Clear filter"; add a search box "Search employee". Columns: S.No, Employee Name (HrAvatar "Rahul Verma" sub "EMP-0142"), Email, Department "Engineering", Joining Date "18 Sep 2026", Progress "6 of 9 tasks" (new), Status pill (In Progress=warn, Completed=ok, On Hold=red), Action: ghost "View" + kebab with "View onboarding · Put on hold / Resume onboarding / Reopen onboarding · Open employee profile · Open template". Footer "Showing 1–10 of 23" with HrPagination.
Asset Allocation tab: intro line + primary "Register asset" opening an HrDrawer (Company, Asset tag "LT-0231", Category "Laptop", Asset name "Dell Latitude 5450", Serial number, Condition notes). TableCard columns: Asset (tag bold, name, serial mono), Category, Employee (link "Rahul Verma" or "Unassigned"), Assigned "12 Sep 2026" / Returned "—", Status pill (Assigned=info, Available=green), Action: ghost "Assign" or "Receive return" (opens HrDrawer with employee picker or "Condition on return" textarea) + ghost "History" (HrDrawer "Allocation history · LT-0231" as a timeline: "Rahul Verma — Assigned 12 Sep 2026 · Currently assigned").
States: TableSkeleton; EmptyState first-run "No onboarding instances yet — Use “Start Onboarding” to create a new hire record and generate their checklist."; filtered "No onboarding runs with this status" with Clear filter; error EmptyState "Failed to load instances" + Retry inside the table body; assets empty "No assets registered."; no-permission message "You do not have access to asset records."
Keep the "—" with tooltip "Your role cannot read employee names" for gated roles.
```

---

## Start Onboarding (new-hire wizard)  `/hrms/onboarding/instances/new`
- **File:** `modules/hrms/onboarding/OnboardingForm.tsx` (+ `saveOnboardingPayroll.ts`, `OnboardingRecord.tsx` for `saveOnboardingRecord`)  ·  **Sidebar:** not in sidebar / reached from Onboarding & Assets › "Start Onboarding"  ·  **Roles:** route guard `anyOf [HRMS_ONBOARDING_INSTANCE_WRITE]` (R_HR in practice)
- **Status:** LIVE — 8-step wizard creating the employee via `useCreateWorkforceEmployee → POST /v1/hrms/employees`, then supplementary writes (probation PATCH, bank account POST, onboarding-record PUT, salary structure POST, document uploads) and `useCreateInstance → POST /v1/onboarding/instances`.

### Purpose
HR creates a new employee record and starts their onboarding checklist in one guided flow: personal details, employment, document verification, salary and bank, statutory benefits, policy pack, assets to issue, joining-day details. Ends on a success card with the generated Employee ID.

### Layout
1. Page title block (`h1` = step title from `STEP_HEAD`: "Create Employee / Onboarding" · "Employment Details" · "Documents" · "Payroll Details" · "Benefits & Statutory" · "Policies" · "Assets" · "Joining Day", plus a description line) — not `HrPageHeader`.
2. Custom horizontal **stepper** (8 steps: Basic Details · Employment · Documents · Payroll · Benefits · Policies · Assets · Joining); completed steps clickable, future steps disabled.
3. Step body inside `Card`s (local component with title/description/actions) using `Field`/`Input`/`Sel`/`Toggle` locals.
   - **Basic Details:** read-only copyable **Employee ID** field (hint "Automatically generated", placeholder "Generated on create", preview from `useNextEmployeeCode`, copy icon button); Full Name*, Email Address*, Phone Number* ("+91 98765 43210"), Date of Birth*, Gender (Male/Female/Other/Prefer not to say); photo rail with "Attach Photo" (PNG/JPG ≤2 MB, hint "JPG, PNG (max 2MB). Saved in Employee Documents when this hire is created.", "Remove") — the photo is the same entry as the "Passport Size Photo" row of the Documents step; Current Address ("House no, street, area, city, state, PIN"), "Same as current address" toggle, Permanent Address*.
   - **Employment:** Employee ID field; Status pill "Onboarding"; Department* (select; hint "No departments yet — add one from Organisation settings."), Branch / Location* (hint "No branches yet — add one from Organisation settings."), Designation* (select filtered by department, or free-text fallback with hint "No designation lookup for this department — entered as free text." and placeholder "e.g. Software Engineer"; "Loading designations..." / alert "Could not load designations. Try again"), Joining Date*, Employment Type* (from `useEmploymentTypes` or Full Time/Part Time/Contract/Intern), Probation Period* (No probation / 1 Month / 3 Months / 6 Months / 12 Months), Reporting Manager (hint "Optional. Search across the company or assign a manager later."; search "Search name, email or employee code" with paged results "Previous managers"/"Next managers"; alert "Could not load managers. Try again"), Notice Period* (15 / 30 / 60 / 90 Days).
   - **Documents:** 3 `CountTile`s Pending / Verified / Rejected; table **Document Type / Required / Status / Upload** for 6 fixed rows — PAN Card*, Aadhaar Card*, Educational Degree Certificate*, Previous Employment Letter, Bank Account Details*, Passport Size Photo* — each with Upload (PDF/JPG/PNG ≤5 MB), then Verify (hidden once VERIFIED) / Reject (hidden once REJECTED) / trash icon "Remove {label}"; **Required** column "Yes"/"No"; status pill Pending=warn, Not Required=gray, Verified=ok, Rejected=red; file name shown under the document type.
   - **Payroll:** Card "Salary Details" — Annual CTC (₹)* ("600000") auto-split into monthly Basic Salary / HRA / Special Allowance / Other Allowance editable inputs with total; Card "Bank Details" — Account Holder Name*, Bank Name* (select + "Other" free text), Account Number* ("9–18 digits"), IFSC Code* ("SBIN0001234"), Account Type*.
   - **Benefits:** Card "Statutory Benefits" — toggles "Enrol in Employees' Provident Fund (EPF)" (hint "12% of basic salary, matched by the employer."), "Enrol in Employees' State Insurance (ESI)" ("Applicable while gross pay is ₹21,000 or less per month."), "Eligible for gratuity" ("Payable after five years of continuous service."); UAN ("12 digits", disabled unless EPF), ESI Number ("10–17 digits"); Card "Company Benefits" — Health Insurance Plan (Not enrolled / Individual / Individual + Spouse / Family Floater); Card "Tax Identification" — PAN Number ("ABCDE1234F"), Aadhaar Number ("1234 5678 9012").
   - **Policies:** Card "Policy Pack" (description "Active company policies. Pick the ones to share on day one — the hire acknowledges them from their own Documents page.") listing ACTIVE policies as checkbox tiles (title + "category · vN · effective date"); header badge "3/7 selected" + one ghost `HrButton` that toggles between "Select all" and "Clear all"; `EmptyState` "No active policies — Publish a policy from HRMS → Policies and it will be offered here for every new hire."
   - **Assets:** Card "Assets to Issue" (description "Record the assets handed to this employee. These details are saved with their onboarding record.") with header `HrButton size=sm` "+ Add Asset"; each row is a bordered card "Asset N" with trash icon "Remove asset N" and fields **Asset Type** (select from `ASSET_TYPES`), **Make / Model** ("e.g. Dell Latitude 5450"), **Serial / Asset Tag** ("e.g. SN-84213"), **Issue Date**; `EmptyState` "No assets added — Add the laptop, devices and accessories this hire needs on day one." with primary "Add Asset".
   - **Joining:** Card "Joining Information" — Onboarding Template (only with `instance.write`; select pre-suggested by designation > department > company-wide template; empty option "No checklist — create the employee only" or "No templates available"; hint "Supplies the checklist and task due dates. Pre-selected from the department and designation." / "No active templates — the hire will be created without an onboarding checklist."), Joining Date (hint "Set on the Employment step."), Work Location (branch select, same hint), Orientation Time (time input), Assigned Laptop (select of laptop rows from the Assets step; hint "Add a laptop on the Assets step to pick one here."), Employee ID Card and Access Card (select "To be issued" / "Issued"); Card "Pre-Joining Checklist" badge "2/5 done" — Documents verified · Payroll setup completed · IT access created · Laptop and assets ready · Welcome kit prepared.
4. **Sticky bottom action bar**: "Step N of 8", ghost `HrButton` "Back", primary "Next" or on last step "Create Employee"/"Creating…".
5. **Success card** (replaces page): check icon, "Employee Created Successfully!", "The employee record has been created and Employee ID has been generated."; `dl` Employee Name / Employee ID (+ "Copy") / Department / Joining Date / Status pill ("Finishing setup" info → "Onboarding in progress" info or "Employee only" gray); status box (saving / error + "Retry pending saves" / "Benefits, asset issues, selected policies and joining details are saved on the employee profile."); amber notice when no checklist started; buttons "Go to Employee Profile" (primary, full width) and "Continue Onboarding" (ghost → instances list).

### Data shown
- Reference data: `useCompanies` (first company), `useDepartments`, `useBranches`, `useDesignations(companyId, departmentId)`, `useEmploymentTypes`, `useEmployeeDirectory` (managers, pageSize 25), `useWorkforceEmployee` (selected manager), `useNextEmployeeCode → next code preview`, `usePolicies(0,'ACTIVE')`, `useTemplates(companyId) → GET /v1/onboarding/templates?companyId=…` (active only).
- Writes on Create: `POST /v1/hrms/employees` (roleCode fixed 'EMPLOYEE', salaryFrequency 'MONTHLY'); then `saveSupplementary`: `useUpdateWorkforceEmployee` PATCH employmentStatus PROBATION + probationEndDate (or ACTIVE); `GET/POST /v1/employees/{id}/profile/bank-accounts`; `PUT /v1/hrms/employees/{id}/onboarding-record`; `saveOnboardingPayroll` → `GET /v1/payroll/structures/employee/{id}`, `GET/POST /v1/payroll/components`, `POST /v1/payroll/structures` (only if user can configure payroll); `useCreateDocument → POST /v1/document/upload` per verified file; finally `POST /v1/onboarding/instances` {employeeId, templateId, joiningDate}.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Step chips | stepper | jump to a reached step | — | LIVE |
| Copy (Employee ID) | Basic/Employment field (icon button), success card ("Copy") | clipboard copy; toast "Employee ID copied" / info "The employee ID is issued when the record is created" / warning "Could not copy — select the field and copy manually" | — | LIVE |
| Attach Photo / Remove | Basic | local file (≤2 MB PNG/JPG; toast "Photo must be 2MB or smaller"); stored as the `photo` document entry | — | LIVE (uploaded on create) |
| Same as current address | Basic | toggle; permanent address mirrors current | — | LIVE |
| Search managers / Previous / Next managers | Employment | paged `useEmployeeDirectory` | — | LIVE |
| Try again (designations/managers) | Employment alerts | refetch | — | LIVE |
| Upload / Verify / Reject / Remove | Documents rows | local doc state; magic-byte check PDF/PNG/JPG, ≤5 MB (toasts "Choose a non-empty file of 5MB or smaller", "Choose a PDF, JPG or PNG file", "This file is not a supported PDF, PNG or JPG document", "Could not read the selected file. Please choose it again.") | — | LIVE |
| Add Asset / Remove asset N | Assets header + row trash | local rows | — | LIVE |
| Select all / Clear all | Policies header | single toggling ghost button: selects every active policy or clears all | — | LIVE |
| Checklist tiles | Joining | local booleans | — | LIVE |
| Back | sticky bar | previous step; on step 1 → `/hrms/onboarding/instances` | — | LIVE |
| Next | sticky bar | validates current step (toast "Fix the highlighted fields to continue"); Documents step warns "N required document(s) still to verify — you can collect them later." but proceeds; disabled on Employment while designations load/fail | — | LIVE |
| Create Employee | sticky bar (step 8) | full validation (jumps to first failing step) → POST employee → supplementary saves → POST instance; toasts "Employee created and onboarding started" / "Employee created" / "Employee created, but the onboarding checklist could not be started"; 402 seat-limit and duplicate-email handled | hrms.onboarding.instance.write (+ payroll config for salary structure) | LIVE |
| Retry pending saves | success card | re-runs `saveSupplementary(created.id)` idempotently | — | LIVE |
| Go to Employee Profile | success card | `navigate('/hrms/employees/{id}')` | — | LIVE |
| Continue Onboarding | success card | `navigate('/hrms/onboarding/instances')` | — | LIVE |

### States
- Loading: designations "Loading designations..."; company not loaded → toast "Company data is still loading — try again in a moment."
- Validation errors inline per field ("Full name is required", "Email address is required", "Annual CTC is required", "IFSC code is required"…).
- Success: "Finishing setup" pill while supplementary saves run; "Saving the hire's setup and starting the selected checklist. Please keep this page open."; error box "Employee created, but some onboarding details or files could not be saved: {msg}. Keep this page open to retry pending uploads."; amber "No onboarding template was selected, so this hire has no checklist and will not appear on the onboarding dashboard." or "…the onboarding checklist could not be started: {msg} You can start it from the onboarding dashboard."; note "The annual CTC and bank account are saved. A payroll administrator must configure the component breakup in the employee's Payroll tab." when the user lacks payroll config.
- Seat limit: toast "{msg} A seat is one active employee — free one up or add seats from Billing."; duplicate email → field error "That email is already in use for this company." and jump to Basic.

### Rules & permissions
- Route needs `hrms.onboarding.instance.write`; template select only shown with that permission; templates need `hrms.onboarding.template.read`.
- Blocking validation exists only for Basic, Employment, Payroll and Benefits (`validateFor` / `validateAll`); Documents, Policies, Assets and Joining never block Next or Create.
- Employee code is server-issued (preview only). roleCode always EMPLOYEE. Probation months → employmentStatus PROBATION with computed `probationEndDate`; "No probation" → ACTIVE.
- Supplementary saves are idempotent (bank account matched on last4/IFSC/holder; salary structure skipped if same revision note + effectiveFrom; uploads deduped) so retries never duplicate.
- Policy selection is a handover record, not employee acknowledgement (code comment + "Selection does not record an employee acknowledgement.").
- Files: docs ≤5 MB PDF/PNG/JPG (photo must be image), photo ≤2 MB.

### Gaps & plan
- **Keep:** the 8-step order, sticky Back/Next bar, honest success card that distinguishes "Employee only" vs "Onboarding in progress", idempotent retry.
- **Add:**
  - [BLUEPRINT §13 / PLAN §10] candidate → employee conversion should pre-fill this wizard (name/contact/CTC) from a HIRED candidate; today entry is always blank.
  - [code: OnboardingForm.tsx] Assets step captures assets as free text into the onboarding record only — it does not create/assign records in the Asset Allocation register (`/v1/onboarding/assets`); the two are disconnected.
  - [code] no draft save — leaving the wizard loses all 8 steps.
- **Change:**
  - Page uses a bespoke `h1`+stepper rather than `HrPageHeader`; align header with the rest of the group (crumb "Recruitment & Onboarding", title per step).
  - "Next" on Documents allows skipping required docs with only a warning toast — make the pending count visible in the sticky bar.
  - Success card "Joining Date" renders raw `created.dateOfJoining` (ISO) — format `18 Sep 2026`.

### Screenshot
`Attach: /hrms/onboarding/instances/new — current screen`

### Claude Design prompt (ready to paste)
```
Design the Start Onboarding wizard (/hrms/onboarding/instances/new) for HR_MANAGER. HrPageHeader crumb "Recruitment & Onboarding › Onboarding & Assets", title "Create Employee / Onboarding", subtitle "Fill in the basic details to create a new employee record. Employee ID will be generated automatically." Below it an 8-step stepper: Basic Details · Employment · Documents · Payroll · Benefits · Policies · Assets · Joining (done steps clickable, future disabled).
Step cards use Field/Input: Basic Details (read-only copyable Employee ID "EMP-0143" with hint "Automatically generated", Full Name*, Email Address*, Phone Number* "+91 98765 43210", Date of Birth*, Gender, photo rail with "Attach Photo" ≤2 MB, Current/Permanent Address with "Same as current address" toggle). Employment (Department*, Branch / Location* "Bengaluru — Whitefield", Designation*, Joining Date* 18 Sep 2026, Employment Type*, Probation Period*, Reporting Manager search, Notice Period*). Documents: 3 count tiles Pending 2 / Verified 3 / Rejected 1 and a table Document Type · Required · Status pill · Upload/Verify/Reject for PAN Card, Aadhaar Card, Educational Degree Certificate, Previous Employment Letter, Bank Account Details, Passport Size Photo. Payroll: Annual CTC (₹) "₹6,00,000" auto-split to monthly Basic ₹25,000 / HRA ₹10,000 / Special Allowance / Other Allowance; Bank Details (Account Holder Name, Bank Name, Account Number, IFSC "SBIN0001234", Account Type). Benefits: EPF/ESI/Gratuity toggles with the hints, UAN, ESI Number, Health Insurance Plan, PAN "ABCDE1234F", Aadhaar. Policies: checkbox tiles with "3/7 selected" and a "Select all"/"Clear all" toggle. Assets: bordered rows "Asset 1" with Asset Type select / Make / Model "e.g. Dell Latitude 5450" / Serial / Asset Tag "e.g. SN-84213" / Issue Date and header "+ Add Asset". Joining: Onboarding Template select ("No checklist — create the employee only"), Joining Date, Work Location (branch), Orientation Time, Assigned Laptop, Employee ID Card / Access Card ("To be issued" / "Issued"), Pre-Joining Checklist "2/5 done".
Sticky bottom bar: "Step 3 of 8" · ghost "Back" · primary "Next" / "Create Employee". Show the pending-required-documents count in the bar.
Success card: "Employee Created Successfully!", Employee Name / Employee ID EMP-0143 (Copy) / Department / Joining Date 18 Sep 2026 / Status pill "Onboarding in progress"; amber notice variant "No onboarding template was selected…"; buttons "Go to Employee Profile" and "Continue Onboarding". Add a "Retry pending saves" ghost in the error variant.
```

---

## Onboarding Checklist (instance detail)  `/hrms/onboarding/instances/:instanceId`
- **File:** `modules/hrms/onboarding/InstanceDetail.tsx` (related: `OnboardingRecord.tsx` — rendered on the Employee Profile Overview tab, not here)  ·  **Sidebar:** not in sidebar / reached from Onboarding & Assets row "View"  ·  **Roles:** route guard `anyOf [HRMS_ONBOARDING_INSTANCE_READ, HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read']`
- **Status:** LIVE — `useInstance → GET /v1/onboarding/instances/{id}`, `useInstanceTasks → GET /v1/onboarding/instances/{id}/tasks`, complete/skip via `POST /v1/onboarding/instance-tasks/{taskId}/complete|skip`.

### Purpose
The working checklist for one new hire: HR (or a task owner) ticks off tasks, adds a completion note, skips optional ones, and watches the progress bar until the run auto-completes.

### Layout
1. Back link "← Instances" → `/hrms/onboarding/instances`.
2. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Onboarding Checklist", subtitle "Started {startedAt localeDate} · Completed {completedAt}"; actions = `HrStatusPill` In Progress (warn) / Completed (ok) / On Hold (red).
3. Progress block: "{completed} of {total} tasks complete" + "{pct}%" and an emerald progress bar.
4. Task list (sorted by `sequenceNo`): each `TaskCard` (`ut-card`-like bordered box, 60% opacity when done) — status icon (check / skip-forward / clock), title (strikethrough when done), "Due {dueDate}", pills "Required" (warn, only while open) + status pill COMPLETED=ok / SKIPPED=gray / else warn (raw enum text). Action row (only when not done and `HRMS_ONBOARDING_TASK_COMPLETE`): primary `HrButton size=sm` "Complete"/"Completing…", ghost "Add note" (reveals textarea "Optional completion notes"), ghost "Skip" (non-required only), ghost "Cancel note".

### Data shown
- Instance: id, status, startedAt, completedAt — `GET /v1/onboarding/instances/{instanceId}`.
- Tasks: id, title, dueDate, required, status (PENDING/COMPLETED/SKIPPED), sequenceNo — `GET /v1/onboarding/instances/{id}/tasks`.
- Employee name is **not** shown anywhere on this page (title is generic "Onboarding Checklist").
- Supplementary onboarding record (`OnboardingRecord.tsx` → `GET /v1/hrms/employees/{employeeId}/onboarding-record`: details grid, "Recorded asset issues" table Type/Model/Serial/Issued on, "Policies selected for the hire", "Joining checklist" Confirmed/Pending, "Document verification checklist") is rendered on `EmployeeDetail` Overview for users with `HRMS_EMPLOYEE_WRITE`, not on this page.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Instances | top | `navigate('/hrms/onboarding/instances')` | — | LIVE |
| Complete | task card | `useCompleteTask → POST /v1/onboarding/instance-tasks/{taskId}/complete` {notes?}; toast "Task completed" | HRMS_ONBOARDING_TASK_COMPLETE | LIVE |
| Add note / Cancel note | task card | toggles notes textarea | same | LIVE |
| Skip | task card (non-required) | `useSkipTask → POST …/skip`; toast "Task skipped" | same | LIVE |
| Retry | error EmptyState | refetch instance + tasks | — | LIVE |

### States
- Loading: `TableSkeleton`. Error: `EmptyState variant=error` "Failed to load instance" + Retry. Not found: `EmptyState first-run` "No onboarding instance — This employee does not have an active onboarding instance." No tasks: "No tasks in this instance."
- ON_HOLD instances still allow completing tasks (no lock in UI).

### Rules & permissions
- Read via instance.read / task.complete / asset.read; mutations gated by `<Can code=HRMS_ONBOARDING_TASK_COMPLETE>`.
- Required tasks cannot be skipped. Completing the last task auto-completes the instance (server).

### Gaps & plan
- **Keep:** progress bar, task cards with note/skip, one-click Complete (fixed 2026-09-10 per code comment).
- **Add:**
  - [PLAN §11] reminders and task reassignment (ownerRole exists on template tasks but is not shown or actionable here).
  - [code] show the employee (HrAvatar name + EMP code), template name, and owner role per task — none are displayed.
  - [code] no "Put on hold / Resume" here; only from the list kebab.
- **Change:** status pill shows raw task enum (e.g. "PENDING"); subtitle uses `toLocaleDateString()` — format `18 Sep 2026`; dueDate raw ISO.

### Screenshot
`Attach: /hrms/onboarding/instances/:instanceId — current screen`

### Claude Design prompt (ready to paste)
```
Design the Onboarding Checklist page (/hrms/onboarding/instances/:id) for HR_MANAGER and task owners. Back link "← Instances". HrPageHeader crumb "Recruitment & Onboarding › Onboarding & Assets", title "Onboarding Checklist", subtitle "Rahul Verma · EMP-0142 · Engineering Hire template · Started 18 Sep 2026", actions: HrStatusPill "In Progress" (warn) + ghost HrButton "Put on hold".
Progress block: "6 of 9 tasks complete · 67%" with an emerald progress bar.
Task list ordered by sequence: card per task with status icon, title "Complete IT setup", "Due 20 Sep 2026", pills "Required" (warn) + owner "HR_MANAGER" (info) + status (Pending=warn, Completed=ok, Skipped=gray, Title Case), completion note preview. Actions on open tasks: primary sm "Complete", ghost "Add note" (textarea "Optional completion notes"), ghost "Skip" only for non-required. Done tasks dim to 60% with strikethrough title.
States: TableSkeleton; error EmptyState "Failed to load instance" + Retry; "No tasks in this instance."; not-found EmptyState "No onboarding instance". Keep one-click Complete (notes optional).
```

---

## Onboarding Templates  `/hrms/onboarding`
- **File:** `modules/hrms/onboarding/Templates.tsx`  ·  **Sidebar:** not in sidebar / reached only by URL or from the Template Detail back link "← Templates" (the Instances kebab "Open template" lands on the detail page, not this list)  ·  **Roles:** route guard `anyOf [HRMS_ONBOARDING_TEMPLATE_READ]`
- **Status:** LIVE — `useTemplates → GET /v1/onboarding/templates`; create/delete wired. (Reachable only by URL or via the template detail back link — effectively a hidden admin page.)

### Purpose
HR defines reusable onboarding checklists ("Engineering Hire", "Sales Hire") that the wizard attaches to new hires.

### Layout
1. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Onboarding Templates", subtitle "Define reusable task checklists for new hires"; action generic `Button size=sm` "+ New template" (needs `HRMS_ONBOARDING_TEMPLATE_WRITE`).
2. `TableCard` > `hr-table`: **Template** (emerald ClipboardList icon tile + name + truncated description) · **Tasks** → `tasks.length` · **Status** → `HrStatusPill` Active=ok / Inactive=gray · action column: Archive icon button (only when active + write).
3. Row click → `/hrms/onboarding/templates/{id}`.
4. Generic `Drawer` **"Create onboarding template"**: Company* (select, only shown when >1 company; defaults to first), Template name* ("e.g. Engineering Hire"), Description (textarea rows 3, "Optional description"); footer `Button size=sm` "Create template" (loading) + ghost "Cancel".

### Data shown
- `useTemplates() → GET /v1/onboarding/templates` (id, name, description, active, tasks[], companyId, departmentId, designationId).
- `useCompanies` for the create drawer.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| New template | header | opens Create drawer | HRMS_ONBOARDING_TEMPLATE_WRITE | LIVE |
| Create template | drawer footer | `useCreateTemplate → POST /v1/onboarding/templates` {companyId, name, description?, active:true}; toast "Template created" | write | LIVE |
| Cancel | drawer footer | closes | — | LIVE |
| Row click | row | `navigate('/hrms/onboarding/templates/{id}')` | read | LIVE |
| Archive template | row icon (active only) | `window.confirm('Archive "{name}"? It will no longer be available for new hires.')` → `useDeleteTemplate → DELETE /v1/onboarding/templates/{id}`; toast "Template archived" | write | LIVE |
| Retry | error EmptyState | refetch | — | LIVE |

### States
- Loading `TableSkeleton`; error `EmptyState error` "Failed to load templates" + Retry; empty `EmptyState first-run` "No templates yet — Create your first onboarding template to get started." (no CTA in the empty state).
- Create with no company → toast error "Create a company first (Organization → Companies)"; mutation failures toast "Failed to create template" / "Failed to archive template" (sonner).

### Rules & permissions
- Read: `hrms.onboarding.template.read`; write: `hrms.onboarding.template.write` (`<Can>` around New template and Archive).
- Archive = DELETE; UI copy calls it "archive". Inactive rows show no archive button. Default company = first in list.

### Gaps & plan
- **Keep:** simple list + create drawer.
- **Add:**
  - [code: PlatformShell.tsx] no sidebar entry for `/hrms/onboarding` — templates are only reachable via a row kebab or by URL; add a link (e.g. header action "Manage templates" on Onboarding & Assets, or a sub-tab).
  - [code] no department/designation assignment in the create drawer although the template model carries `departmentId/designationId` and the wizard auto-suggests by them.
  - [code] no company column even though templates are company-scoped.
- **Change:** uses generic `Button`/`Drawer` where sibling pages use `HrButton`/`HrDrawer`; `window.confirm` for archive → `ConfirmDialogProvider`; empty state should carry the "New template" CTA.

### Screenshot
`Attach: /hrms/onboarding — current screen`

### Claude Design prompt (ready to paste)
```
Design the Onboarding Templates page (/hrms/onboarding) for HR_MANAGER / COMPANY_ADMIN. HrPageHeader crumb "Recruitment & Onboarding › Onboarding & Assets", title "Onboarding Templates", subtitle "Define reusable task checklists for new hires", action primary HrButton "+ New template".
TableCard columns: Template (icon tile + "Engineering Hire" + description "Laptop, Git access, buddy assignment"), Company "UnifiedTree Pvt Ltd", Applies to "Engineering · Software Engineer" (department/designation, or "All hires"), Tasks 9, Status pill Active=ok / Inactive=gray, row action ghost "Archive" (confirm Modal "Archive “Engineering Hire”? It will no longer be available for new hires."). Rows open the template detail.
"New template" opens HrDrawer "Create onboarding template": Company select (only when >1), Template name* "e.g. Engineering Hire", Description, Department (optional), Designation (optional); footer "Create template" / "Cancel".
States: TableSkeleton; error EmptyState "Failed to load templates" + Retry; empty first-run "No templates yet — Create your first onboarding template to get started." with the "+ New template" CTA.
```

---

## Onboarding Template Detail  `/hrms/onboarding/templates/:id`
- **File:** `modules/hrms/onboarding/TemplateDetail.tsx`  ·  **Sidebar:** not in sidebar / reached from Onboarding Templates row or Instances kebab "Open template"  ·  **Roles:** route guard `anyOf [HRMS_ONBOARDING_TEMPLATE_READ]`
- **Status:** LIVE — `useTemplate → GET /v1/onboarding/templates/{id}`; tasks add/delete and template update wired.

### Purpose
Edit one template's metadata and build its task checklist (title, due-day offset, owner role, required flag).

### Layout
1. Back link "← Templates" → `/hrms/onboarding`.
2. `HrPageHeader` — crumb "Recruitment & Onboarding", title = template name, subtitle = description; actions: `HrStatusPill` Active/Inactive + ghost `HrButton size=sm` "Edit template" (write).
3. Section header "Tasks (N)" + primary `HrButton size=sm` "+ Add task" (write).
4. Task rows (bordered `bg-bg-surface` boxes, sorted by sequenceNo): list-checks icon, title, pills "Required" (warn) and owner role (info), description, "Due day N after joining"; trash icon button (write).
5. Generic `Drawer` **"Edit template"**: Template name*, Description, checkbox "Active"; "Save changes"/"Cancel".
6. Generic `Drawer` **"Add task"**: Task title* ("e.g. Complete IT setup"), Description (rows 2), Due (days after join) (number ≥1, default 1), Owner role ("e.g. HR_MANAGER"), checkbox "Required task" (default on); "Add task"/"Cancel".

### Data shown
- Template + tasks: `GET /v1/onboarding/templates/{id}` (name, description, active, companyId, departmentId, designationId, tasks[{id,title,description,dueOffsetDays,ownerRole,required,sequenceNo}]).

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Templates | top | `navigate('/hrms/onboarding')` | — | LIVE |
| Edit template | header | opens Edit drawer | HRMS_ONBOARDING_TEMPLATE_WRITE | LIVE |
| Save changes | Edit drawer | `useUpdateTemplate → PUT /v1/onboarding/templates/{id}` (echoes companyId/departmentId/designationId); toast "Template updated" | write | LIVE |
| Add task | section header | opens Add task drawer | write | LIVE |
| Add task (submit) | drawer | `useCreateTemplateTask → POST /v1/onboarding/templates/{id}/tasks` {title, description?, dueOffsetDays, ownerRole|null, required, sequenceNo=last+1}; toast "Task added" | write | LIVE |
| Delete task | task row trash (aria "Delete task") | `window.confirm('Delete task "{title}" from this template?')` → `useDeleteTemplateTask → DELETE /v1/onboarding/templates/{id}/tasks/{taskId}`; no success toast, error toast "Failed to delete task" | write | LIVE |
| Cancel | drawers | close | — | LIVE |
| Retry | error EmptyState | refetch | — | LIVE |

### States
- Loading `CardSkeleton`; error `EmptyState error` "Failed to load template" + Retry; no tasks: dashed box "No tasks yet. Add the first task to build the checklist."

### Rules & permissions
- Write actions gated by `usePermission(HRMS_ONBOARDING_TEMPLATE_WRITE)` (fixed after 2026-09-08 audit where read-only users saw the trash icon).
- No reorder: sequenceNo is set at creation only; backend has no reorder endpoint (code comment 2026-09-10 — drag handle was removed).
- dueOffsetDays min 1.

### Gaps & plan
- **Keep:** task cards with Required/owner pills, gated write controls, "Due day N after joining" copy.
- **Add:**
  - [code: TemplateDetail.tsx comment] task reorder (needs backend endpoint); task edit (only add/delete exist).
  - [code] owner role is free text ("e.g. HR_MANAGER") — offer a select of platform roles.
  - [code] no department/designation editing although the template model carries them and the wizard's auto-suggest depends on them.
- **Change:** `window.confirm` → confirm Modal; generic `Drawer`/`Button` → `HrDrawer`/`HrButton` for consistency.

### Screenshot
`Attach: /hrms/onboarding/templates/:id — current screen`

### Claude Design prompt (ready to paste)
```
Design the Onboarding Template Detail page (/hrms/onboarding/templates/:id) for HR_MANAGER. Back link "← Templates". HrPageHeader crumb "Recruitment & Onboarding › Onboarding Templates", title "Engineering Hire", subtitle "Laptop, Git access, buddy assignment", actions: HrStatusPill "Active" + ghost HrButton "Edit template".
Section "Tasks (9)" with primary sm HrButton "+ Add task". Task rows as bordered cards, ordered: title "Complete IT setup", pills "Required" (warn) + owner "HR_MANAGER" (info), description, "Due day 2 after joining", row actions ghost "Edit" and "Delete" (confirm Modal "Delete task “Complete IT setup” from this template?").
HrDrawer "Edit template": Template name*, Description, Department select, Designation select, Active toggle; footer "Save changes"/"Cancel". HrDrawer "Add task": Task title* "e.g. Complete IT setup", Description, Due (days after join) number ≥1, Owner role select (HR_MANAGER / DEPT_MANAGER / EMPLOYEE…), "Required task" checkbox; footer "Add task"/"Cancel".
States: CardSkeleton; error EmptyState "Failed to load template" + Retry; empty dashed box "No tasks yet. Add the first task to build the checklist." Note: no drag-to-reorder (no backend endpoint) — show sequence numbers instead.
```

---

## Letter Templates  `/hrms/letters/templates`
- **File:** `modules/hrms/letters/LetterTemplates.tsx` (hooks `letters/api/useLetters.ts`)  ·  **Sidebar:** Recruitment & Onboarding › Letter Templates (also embedded as the "Letters & Contracts" tab of Employee Vault)  ·  **Roles:** R_HR; route guard `anyOf [HRMS_LETTERS_TEMPLATE_READ]`
- **Status:** LIVE — `useLetterTemplates(page) → GET /v1/letters/templates?page&size=20`; delete wired.

### Purpose
HR maintains the library of merge-field letter templates (Offer, Appointment, Relieving, Experience, Salary Revision, Custom) used by Generate Letter and Distributions.

### Layout
1. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Letter Templates", subtitle "Manage reusable letter templates with merge fields"; action primary `HrButton` "+ Create template" (needs `HRMS_LETTERS_TEMPLATE_CREATE`) → `/hrms/letters/templates/new`.
2. `TableCard` > `hr-table`: **Name** (emerald FileText tile + name + `variantName` sub-line) · **Type** → `HrStatusPill` OFFER=info "Offer", APPOINTMENT=ok "Appointment", RELIEVING=orange "Relieving", EXPERIENCE=purple "Experience", SALARY_REVISION=warn "Salary Revision", CUSTOM=gray "Custom" · **Last Updated** (hidden < md) → `updatedAt` `d MMM yyyy` · **Status** → Active=ok / Inactive=gray · **Actions** → edit icon (UPDATE perm) + `DeleteCell` trash → inline "Delete"/"Cancel" confirm (DELETE perm).
3. Row click → editor. Custom pager below the card (only when >20): "N templates", prev/next, "1 / 2".

### Data shown
- `GET /v1/letters/templates?page={p}&size=20` → id, name, variantName, type, subject, bodyHtml, active, updatedAt, companyId.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Create template | header / empty state | `navigate('/hrms/letters/templates/new')` | HRMS_LETTERS_TEMPLATE_CREATE | LIVE |
| Row click / Edit icon | row | `navigate('/hrms/letters/templates/{id}')` | read / UPDATE | LIVE |
| Delete (trash → Delete) | row | `useDeleteTemplate → DELETE /v1/letters/templates/{id}`; toast '"{name}" deleted' / error "Failed to delete template"; button reads "Deleting…" while pending | HRMS_LETTERS_TEMPLATE_DELETE | LIVE |
| Cancel | inline confirm | resets | — | LIVE |
| Prev / Next | pager | page state | — | LIVE |
| Retry | error EmptyState | refetch | — | LIVE |

### States
- Loading `TableSkeleton`; error `EmptyState error` "Failed to load templates" + Retry; empty dashed panel "No letter templates yet / Create your first template to start generating letters" + "+ Create template" (create perm).

### Rules & permissions
- Read/create/update/delete are separate codes (`HRMS_LETTERS_TEMPLATE_READ/CREATE/UPDATE/DELETE`). Hard delete, no archive. `embedded` prop drops the page padding when rendered inside Employee Vault.

### Gaps & plan
- **Keep:** type pills, inline two-step delete, header CTA.
- **Add:**
  - [BLUEPRINT §7 target IA "Experience Letters*"; §6 row 50; PLAN §16 Exit table "Experience letter — Wire template"] "Experience Letters" leaf wiring an EXPERIENCE template into the Exit flow — no filter/quick-link here today.
  - [code] no search or type filter; no active/inactive toggle from the list (only via editor? — editor has no Active control either; templates are created `active:true` and there is no UI to deactivate).
- **Change:** `variantName` is shown but never editable; pager is hand-rolled — use `HrPagination`; Type tone for SALARY_REVISION differs between this list (warn) and Generated Letters (green) — unify.

### Screenshot
`Attach: /hrms/letters/templates — current screen`

### Claude Design prompt (ready to paste)
```
Design the Letter Templates page (/hrms/letters/templates) for HR_MANAGER / COMPANY_ADMIN. HrPageHeader crumb "Recruitment & Onboarding", title "Letter Templates", subtitle "Manage reusable letter templates with merge fields", action primary HrButton "+ Create template".
TableCard toolbar: search "Search templates" + FilterBar Type (Offer / Appointment / Relieving / Experience / Salary Revision / Custom) and Status (Active / Inactive). Columns: Name (icon tile + "Standard Offer Letter" + variant sub-line), Type pill (Offer=info, Appointment=ok, Relieving=orange, Experience=purple, Salary Revision=warn, Custom=gray), Last Updated "18 Sep 2026", Status pill Active=ok / Inactive=gray, Actions: ghost "Edit" + ghost danger "Delete" with inline two-step confirm ("Delete" / "Cancel"). Add an Active toggle. HrPagination footer, 20 per page.
States: TableSkeleton; error EmptyState "Failed to load templates" + Retry; empty "No letter templates yet — Create your first template to start generating letters" with "+ Create template".
```

---

## Letter Template Editor  `/hrms/letters/templates/:id` (`new` for create)
- **File:** `modules/hrms/letters/LetterTemplateEditor.tsx`  ·  **Sidebar:** not in sidebar / reached from Letter Templates  ·  **Roles:** route guard `anyOf [HRMS_LETTERS_TEMPLATE_READ]` (save needs create/update on the server)
- **Status:** LIVE — `useLetterTemplate → GET /v1/letters/templates/{id}`, `useMergeFieldsCatalogue → GET /v1/letters/merge-fields`, `usePreviewTemplate → POST /v1/letters/templates/{id}/preview` (text/html), save via POST/PUT.

### Purpose
HR writes a letter body in a rich-text editor (TipTap), inserts `{{merge.fields}}`, sets type and subject, and previews the rendered HTML for a chosen employee.

### Layout
1. Top bar (not `HrPageHeader`): back link "← Templates", `h1` "New template" / "Edit template", primary raw button "Save template"/"Saving…".
2. Two-column: left (flex-1) — `ut-card` with **Template name *** ("e.g. Standard Offer Letter"), **Letter type** (select: Offer Letter / Appointment Letter / Relieving Letter / Experience Letter / Salary Revision Letter / Custom), **Subject** ("e.g. Offer of Employment – {{employee.fullName}}"); `ut-card` "Body" with `EditorToolbar` (Bold, Italic, H1, H2, H3, bullet list, ordered list, horizontal rule, "Insert field ▾" dropdown grouped by category showing label + `{{key}}`), `EditorContent` min-height 320 (placeholder "Start writing the letter body…").
3. Right column (md:w-80) `PreviewPane`: card "Preview as employee" — employee `select` (first 200 from `useEmployeeDirectory`, "Select an employee…" / "No employees yet"), button "Preview" (eye/spinner), hint "Save the template first to enable preview"; result card "Rendered output" with sandboxed `iframe srcDoc` (h-96).

### Data shown
- Template fields (name, type, subject, bodyHtml); merge fields catalogue (key, label, category); employees for preview; preview HTML.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Templates | top bar | `navigate('/hrms/letters/templates')` | — | LIVE |
| Save template | top bar | new: `POST /v1/letters/templates` {companyId: first company, name, type, subject, bodyHtml, active:true} → toast "Template created" → navigate list; edit: `PUT /v1/letters/templates/{id}` → toast "Template saved" → navigate list | CREATE / UPDATE | LIVE |
| Bold / Italic / H1 / H2 / H3 / Bulleted list / Ordered list / Horizontal rule | toolbar | TipTap commands | — | LIVE |
| Insert field ▾ → field | toolbar | inserts `{{key}}` at cursor | — | LIVE |
| Employee select | preview | sets employeeId | — | LIVE |
| Preview | preview | `POST /v1/letters/templates/{id}/preview` {employeeId}; renders iframe; toast "Select an employee to preview" / "Failed to generate preview" | — | LIVE (saved templates only) |

### States
- Loading `CardSkeleton` (edit only); error `EmptyState error` "Failed to load template" + "Back"; preview pending `CardSkeleton`; "No merge fields available" in dropdown when catalogue empty; "Save the template first to enable preview" on new.
- Validation: toast "Template name is required"; no company → "Create a company first (Organization → Companies)"; save failure → "Failed to save template".

### Rules & permissions
- New templates always `active:true` and bound to `companies[0]`; there is no Active toggle or company picker in the editor.
- Preview is only available once the template has an id; after save the page navigates away (so preview after first save requires reopening).
- Preview iframe is `sandbox="allow-same-origin"`.

### Gaps & plan
- **Keep:** toolbar + merge-field dropdown, preview-as-employee side panel.
- **Add:**
  - [code] Active toggle and Company select (templates are company-scoped; multi-company tenants can only create for company[0]).
  - [code] variantName field (shown in list, never editable).
  - [code] merge-field validation (unknown `{{key}}` warning) — none.
- **Change:** replace bespoke top bar with `HrPageHeader` (crumb "Recruitment & Onboarding › Letter Templates", actions "Save template"); after save stay on the page (currently navigates away, so preview can never be used on a just-created template without reopening); raw buttons → `HrButton`; employee select loads 200 rows — use a searchable picker like GenerateLetterDrawer.

### Screenshot
`Attach: /hrms/letters/templates/:id — current screen`

### Claude Design prompt (ready to paste)
```
Design the Letter Template Editor (/hrms/letters/templates/:id) for HR_MANAGER. HrPageHeader crumb "Recruitment & Onboarding › Letter Templates", title "Edit template" (or "New template"), actions: ghost "Cancel", primary HrButton "Save template".
Two-column layout. Left: card with Template name* "Standard Offer Letter", Letter type select (Offer Letter / Appointment Letter / Relieving Letter / Experience Letter / Salary Revision Letter / Custom), Subject "Offer of Employment – {{employee.fullName}}", Company select, Active toggle. Card "Body": toolbar Bold · Italic · H1 · H2 · H3 · bullet list · ordered list · horizontal rule · "Insert field ▾" dropdown grouped by category (Employee / Company / Salary…) showing label and mono {{employee.code}}; rich-text area min-height 320 with placeholder "Start writing the letter body…".
Right rail (320px): card "Preview as employee" with searchable employee picker ("Priya Sharma (EMP-0142)") + "Preview" button; below it card "Rendered output" showing the rendered letter in a sandboxed frame; hint "Save the template first to enable preview" when new.
States: CardSkeleton while loading; error EmptyState "Failed to load template" + Back; toast "Template name is required". Keep the user on the page after Save with toast "Template saved".
```

---

## Generated Letters  `/hrms/letters/generated`
- **File:** `modules/hrms/letters/GeneratedLetters.tsx` (+ `GenerateLetterDrawer.tsx`)  ·  **Sidebar:** Recruitment & Onboarding › Generated Letters  ·  **Roles:** R_HR; route guard `anyOf [HRMS_LETTERS_READ, HRMS_LETTERS_READ_SELF]` — employees with read.self see only their own letters
- **Status:** LIVE — admins `useGeneratedLetters → GET /v1/letters/generated?page&size=20`; self `useMyLetters → GET /v1/letters/my`; generate `POST /v1/letters/generate`; PDF `GET /v1/letters/generated/{id}/pdf`.

### Purpose
HR generates a letter PDF for one employee from a template and tracks every generated letter's status (Generated → Sent → Viewed → Signed, or Void). Deep-linked from the Employee Profile with `?employeeId=` which auto-opens the drawer.

### Layout
1. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Generated Letters", subtitle "{total} letter(s) total"; action primary `HrButton` "+ Generate Letter" (needs `HRMS_LETTERS_GENERATE`).
2. `TableCard` (footer "Showing 1–20 of N", prev/next, "1 / 3") > `hr-table`: **Employee** (FileText tile + `employeeName` / fallback context or "Employee record unavailable"; sub `employeeCode` or short id) · **Type** (hidden < sm) pill (SALARY_REVISION=green here) · **Subject** (hidden < md, truncated 60 chars, title tooltip) · **Generated At** (hidden < lg) `d MMM yyyy, HH:mm` · **Status** pill GENERATED=gray, SENT=info, VIEWED=green, SIGNED=ok, VOID=red · **Actions** → eye icon "View", download icon "Download PDF" (only if `hasPdf`).
3. `HrDrawer` **"Generate letter"** (`width max-w-2xl`): intro "Choose a company template and employee to create a PDF for review. Generating a letter saves it without sending an email."; section "1. Choose a template" — list of active templates as selectable tiles (name + "offer · subject"), `HrPagination` (20), "No active templates on this page. Create a template" link (create perm), "Selected template: {name}"; section "2. Choose the employee" — selected employee chip (name + code), alert "The selected employee belongs to a different company…", search "Search name, code or email", scrollable results (name, "EMP-0142 · email"), `HrPagination` (10); footer ghost "Cancel", primary "Generate PDF"/"Generating..." (disabled until both chosen and same company). Error `Failure` block with "Try again".

### Data shown
- Letters page: id, employeeId, employeeName, employeeCode, type, subject, status, createdAt, hasPdf, generationContext.
- Drawer: templates `GET /v1/letters/templates?page` (active only), employees `useEmployeeDirectory({companyId: template.companyId, search, page, pageSize 10})`, initial employee `useWorkforceEmployee(initialEmployeeId)`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| Generate Letter | header | opens drawer (also auto-opened by `?employeeId=`) | HRMS_LETTERS_GENERATE | LIVE |
| Template tile | drawer | selects template, resets employee search | HRMS_LETTERS_TEMPLATE_READ | LIVE |
| Create a template | drawer (no active) | `navigate('/hrms/letters/templates/new')` | TEMPLATE_CREATE | LIVE |
| Template / employee pagination | drawer | `HrPagination` | — | LIVE |
| Find employee | drawer | search → directory query | HRMS_EMPLOYEE_READ | LIVE |
| Employee row | drawer | selects employee | — | LIVE |
| Generate PDF | drawer footer | `useGenerateLetter → POST /v1/letters/generate` {templateId, employeeId, sendImmediately:false} → close → navigate `/hrms/letters/generated/{id}` | GENERATE | LIVE |
| Cancel | drawer footer | closes; strips `?employeeId` | — | LIVE |
| Try again | drawer failure blocks | refetch | — | LIVE |
| View (eye) | row | `navigate('/hrms/letters/generated/{id}')` | read / read.self | LIVE |
| Download PDF | row (hasPdf) | `downloadLetterPdf → GET /v1/letters/generated/{id}/pdf` blob; filename `letter-{type}-{id8}.pdf`; toast on failure | — | LIVE |
| Prev / Next | TableCard footer | page state | — | LIVE |
| Retry | error EmptyState | refetch | — | LIVE |

### States
- Loading `TableSkeleton`; error `EmptyState error` "Failed to load letters" + Retry; empty `EmptyState first-run` "No letters generated yet — Use the Generate Letter button to create one."
- Drawer: "Loading templates..." / "Loading employees..."; "No employees match this search."; "Choose a template first to find employees in its company."; permission copy "Template access is required to generate a letter. Ask your administrator to enable template viewing." / "Employee directory access is required to choose a recipient."; generate error kept visible in drawer.

### Rules & permissions
- `hrms.letters.read` → whole tenant; `hrms.letters.read.self` only → `/letters/my`. Generate needs `HRMS_LETTERS_GENERATE`; picking needs template read + employee read.
- Employee must belong to the template's company (`sameCompany` check). Generation never emails (`sendImmediately:false`).

### Gaps & plan
- **Keep:** two-step drawer with company-scoped employee search, deep-link auto-open, honest "saves without sending" copy.
- **Add:**
  - [BLUEPRINT §7 target IA] "Experience Letters" leaf `/hrms/letters/generated?type=EXPERIENCE` — the page ignores a `type` param; add type/status filters and employee search.
  - [code] no KPI strip (letters this month / awaiting send / signed) — sibling pages have one.
  - [code] no override of merge values at generation (`overrides` exists on preview API but not exposed).
- **Change:** row "View" is an icon-only button — use ghost `HrButton` "View"; subtitle "N letters total" belongs in a stat card; SALARY_REVISION tone (green) disagrees with Letter Templates (warn).

### Screenshot
`Attach: /hrms/letters/generated — current screen`

### Claude Design prompt (ready to paste)
```
Design the Generated Letters page (/hrms/letters/generated) for HR_MANAGER (and an EMPLOYEE read-only variant showing only their own letters). HrPageHeader crumb "Recruitment & Onboarding", title "Generated Letters", subtitle "Letters generated from templates, ready to send", action primary HrButton "+ Generate Letter".
KPI strip HrStatCard: Total 128 · Awaiting send 6 · Sent this month 23 · Void 2. TableCard toolbar: search "Search employee or subject", FilterBar Type (Offer / Appointment / Relieving / Experience / Salary Revision / Custom) and Status (Generated / Sent / Viewed / Signed / Void). Columns: Employee (HrAvatar "Priya Sharma" sub "EMP-0142"), Type pill, Subject "Offer of Employment – Priya Sharma" (truncate 60), Generated At "18 Sep 2026, 14:05", Status pill (Generated=gray, Sent=info, Viewed=green, Signed=ok, Void=red), Actions ghost "View" + ghost "Download PDF" (only when a PDF exists). Footer "Showing 1–20 of 128" HrPagination.
"+ Generate Letter" opens HrDrawer "Generate letter" (max-w-2xl): intro "Choose a company template and employee to create a PDF for review. Generating a letter saves it without sending an email."; "1. Choose a template" selectable tiles (name + "offer · subject") with HrPagination; "2. Choose the employee" search "Search name, code or email", result rows "Priya Sharma — EMP-0142 · priya@…", selected chip, alert "The selected employee belongs to a different company…"; footer ghost "Cancel" + primary "Generate PDF" (disabled until both chosen).
States: TableSkeleton; error "Failed to load letters" + Retry; empty "No letters generated yet — Use the Generate Letter button to create one."; drawer copy "No active templates on this page. Create a template", "No employees match this search."
```

---

## Generated Letter Detail  `/hrms/letters/generated/:id`
- **File:** `modules/hrms/letters/GeneratedLetterDetail.tsx`  ·  **Sidebar:** not in sidebar / reached from Generated Letters row "View" or after Generate  ·  **Roles:** route guard `anyOf [HRMS_LETTERS_READ, HRMS_LETTERS_READ_SELF]`
- **Status:** LIVE — `useGeneratedLetter → GET /v1/letters/generated/{id}`; send/void/delete wired.

### Purpose
Review one generated letter, download its PDF, email it to the employee (with optional CC), void it with a reason, or delete it.

### Layout
1. Back link "← Generated Letters".
2. `HrPageHeader` — crumb "Recruitment & Onboarding", title = subject, subtitle "{employeeName} ({employeeCode})"; actions: type pill (APPOINTMENT=teal, SIGNED=teal here), status pill, ghost `HrButton` "Download PDF" (if hasPdf).
3. Grid 2/3 + 1/3. Left: `ut-card` meta grid — **Created At** `d MMM yyyy, HH:mm`, **Generated By** (truncated id, mono), **Template ID** (truncated id, mono), **PDF Size** "12.4 KB"; collapsible `ut-card` "Generation Context (N)" → table Key / Value.
4. Right: `ut-card` "Actions" — "Send Letter" toggle button (SEND perm) revealing `SendForm` (To Email prefilled `sentToEmail`, placeholder "employee@example.com"; CC Email (optional) "manager@example.com"; primary `HrButton` "Send Letter"/"Sending…"; success box "Letter sent successfully. Sent to …"); "Void Letter" toggle (VOID perm; disabled "Already Voided" when VOID) revealing `VoidForm` (Reason* textarea "Explain why this letter is being voided…", danger `HrButton` "Confirm Void"/"Voiding…" disabled until a reason is typed; success "Letter has been voided."); "Delete Letter" (DELETE perm) → inline "Permanently delete this letter?" with "Cancel"/"Yes, Delete"/"Deleting…".
5. Right: `ut-card` "Status History" — "Sent" + timestamp + sentToEmail, or italic "Not yet sent"; "Voided" + timestamp + quoted reason.

### Data shown
- `GET /v1/letters/generated/{id}`: subject, type, status, employeeName, employeeCode, createdAt, generatedBy, templateId, pdfSizeBytes, hasPdf, generationContext{}, sentAt, sentToEmail, voidedAt, voidedReason.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Generated Letters | top | navigate list | — | LIVE |
| Download PDF | header | `GET /v1/letters/generated/{id}/pdf` blob download | — | LIVE |
| Generation Context toggle | left card | expand/collapse key/value table | — | LIVE |
| Send Letter (toggle) | Actions card | reveals SendForm, hides VoidForm | HRMS_LETTERS_SEND | LIVE |
| Send Letter (submit) | SendForm | `useSendLetter → POST /v1/letters/generated/{id}/send` {toEmail?, ccEmail?}; toast "Letter sent" | SEND | LIVE |
| Void Letter (toggle) | Actions card | reveals VoidForm; disabled when already VOID | HRMS_LETTERS_VOID | LIVE |
| Confirm Void | VoidForm | `useVoidLetter → POST /v1/letters/generated/{id}/void` {reason}; toast "Letter voided" | VOID | LIVE |
| Delete Letter → Yes, Delete | Actions card | `useDeleteGeneratedLetter → DELETE /v1/letters/generated/{id}`; toast "Letter deleted"; navigate list | HRMS_LETTERS_DELETE | LIVE |
| Cancel (delete) | Actions card | resets confirm | — | LIVE |
| Retry / Back | error EmptyState | refetch / navigate | — | LIVE |

### States
- Loading `CardSkeleton`; error `EmptyState error` "Failed to load letter" + Retry + Back; not found `EmptyState filtered` "Letter not found" + "Back to letters".
- Post-send/void the forms swap to inline success boxes but header pills only update after refetch. Failures toast "Failed to send letter" / "Failed to void letter" / "Failed to delete letter" (sonner); PDF download failure toasts the error or "Unable to download PDF".

### Rules & permissions
- Send/Void/Delete each behind their own `<Can>`; Void disabled when VOID. Reason required to void. Delete is permanent (inline confirm).
- The rendered letter body is **not** shown on this page — only metadata and PDF download.

### Gaps & plan
- **Keep:** Actions rail with Send / Void / Delete and Status History.
- **Add:**
  - [code] inline letter preview (HTML/PDF) — the page shows ids and sizes but never the letter itself.
  - [code] Generated By / Template ID show truncated UUIDs — resolve to user name and template name (template name is available via `GET /v1/letters/templates/{id}`).
  - [code] no "Regenerate" or "Mark signed" — VIEWED/SIGNED statuses exist but have no UI transition.
- **Change:** raw `<button>`s in the Actions rail → `HrButton` (primary / danger / ghost); after void/send refetch so header pills update; Void should use a confirm `Modal` rather than an inline toggled form.

### Screenshot
`Attach: /hrms/letters/generated/:id — current screen`

### Claude Design prompt (ready to paste)
```
Design the Generated Letter Detail page (/hrms/letters/generated/:id) for HR_MANAGER. Back link "← Generated Letters". HrPageHeader crumb "Recruitment & Onboarding › Generated Letters", title "Offer of Employment – Priya Sharma", subtitle "Priya Sharma (EMP-0142)", actions: type pill "Offer" + status pill "Sent" + ghost HrButton "Download PDF".
Two-column 2/3 + 1/3. Left: a letter preview card (rendered body / PDF frame) above a meta card: Created At "18 Sep 2026, 14:05", Generated By "Anita Rao", Template "Standard Offer Letter", PDF Size "12.4 KB"; collapsible "Generation Context (14)" key/value table (mono keys like employee.code).
Right rail: card "Actions" with primary HrButton "Send Letter" (opens form: To Email prefilled, CC Email optional, "Send Letter"), ghost "Void Letter" (confirm Modal with required Reason textarea and danger "Confirm Void"; disabled label "Already Voided" when void), danger-ghost "Delete Letter" with inline "Permanently delete this letter?" Cancel / Yes, Delete. Card "Status History": timeline "Generated 18 Sep 2026, 14:05" → "Sent 18 Sep 2026, 15:10 · priya@example.com" → "Voided … “reason”" or italic "Not yet sent".
States: CardSkeleton; error EmptyState "Failed to load letter" with Retry and Back; "Letter not found" with Back to letters.
```

---

## Letter Distributions  `/hrms/letters/distributions`
- **File:** `modules/hrms/letters/Distributions.tsx` (+ `DistributionWizard.tsx`, `components/RecipientPicker.tsx`; hooks `letters/api/useDistribution.ts`)  ·  **Sidebar:** Recruitment & Onboarding › Letter Distributions  ·  **Roles:** R_HR; route guard `anyOf [HRMS_LETTERS_DISTRIBUTE, HRMS_LETTERS_READ]`
- **Status:** LIVE — `useDistributions → GET /v1/letters/distributions?page=0&size=20`; create `POST /v1/letters/distributions`.

### Purpose
HR sends one letter template to many employees at once (payslips, policy broadcasts) and tracks each bulk job.

### Layout
1. `HrPageHeader` — crumb "Recruitment & Onboarding", title "Letter Distributions", subtitle "Send a letter to many employees in one action"; action primary `HrButton` "+ New Distribution" (DISTRIBUTE perm).
2. `TableCard` > `hr-table`: **Title** · **Recipients** → "{sentCount}/{totalRecipients} sent · {failedCount} failed" · **Status** pill PENDING=gray "Pending", PROCESSING=info "Processing", COMPLETED=ok "Completed", PARTIAL_FAILURE=warn "Partial", FAILED=red "Failed" · **Created** (hidden < sm) `dd MMM yyyy, HH:mm`. Row click → detail. No pagination (page 0 only).
3. **New Distribution wizard** (custom fixed right panel, `max-w-xl`, glass card; not `HrDrawer`): header "New Distribution" + X; 4-step chip bar "1. Template · 2. Recipients · 3. Message · 4. Confirm".
   - Step 1: **Letter template** select (active templates; "No active templates — create one first"); preview box "Subject preview" + "Merge fields like {{employee.firstName}} are filled per recipient."
   - Step 2: filter chips All employees / By department / By designation / By employment type / Custom list; chip pickers for departments, designations (`title`), employment types (FULL TIME / PART TIME / CONTRACT / INTERN / CONSULTANT); `RecipientPicker` (search "Search employees…", "N selected", checkbox rows "Name (EMP-0142)", amber "no email"); emerald info box "This will send to **N** employees." + amber "M have no email on file and will be skipped."
   - Step 3: **Title *** ("e.g. November 2026 Salary Slips"), **Email subject (optional)** ("Defaults to a standard subject"), **Message to recipients** (textarea rows 5, "e.g. Please find attached your salary slip for November 2026.", hint "Sent in the email body above the attached document.").
   - Step 4: summary rows Template / Recipients ("N employees (M skipped — no email)") / Title / Message; amber warning "This will send **N** emails immediately. This cannot be undone."
   - Footer: "‹ Back" (step>1), "Next ›" (disabled until step valid) or "Send to N employees" (spinner while pending).

### Data shown
- Jobs: id, title, status, sentCount, failedCount, totalRecipients, createdAt.
- Wizard: templates `GET /v1/letters/templates` (active), `useDepartments(companies[0])`, `useDesignations(companies[0])`, `useEmployeeDirectory({pageSize:500})` tenant-wide for the live count.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| New Distribution | header | opens wizard | HRMS_LETTERS_DISTRIBUTE | LIVE |
| Row click | row | `navigate('/hrms/letters/distributions/{id}')` | read | LIVE |
| X / overlay click | wizard | closes | — | LIVE |
| Template select | step 1 | sets templateId | — | LIVE |
| Filter chips / dept / desig / type chips | step 2 | build recipientFilter | — | LIVE |
| RecipientPicker search + checkboxes | step 2 (Custom list) | toggles employee ids | — | LIVE |
| Back / Next | wizard footer | step navigation; Next disabled until template chosen / ≥1 targeted / title entered | — | LIVE |
| Send to N employees | step 4 | `useCreateDistribution → POST /v1/letters/distributions` {templateId, title, customMessage?, subjectOverride?, recipientFilter{type, values|employeeIds}}; toast "Distribution started" / error message or "Failed to start distribution"; navigate to job detail | DISTRIBUTE | LIVE |

### States
- Loading `TableSkeleton`; empty `EmptyState first-run` "No distributions yet — Send a letter (payslips, policy broadcasts…) to many employees at once." **No error state** (isError unhandled).
- Wizard: "No departments." / "No designations." / "No employees match"; send disabled when `targeted - noEmail < 1`.

### Rules & permissions
- Distribute needs `HRMS_LETTERS_DISTRIBUTE`; read-only viewers (`HRMS_LETTERS_READ`) see the list without the button.
- Recipient count is computed client-side from a 500-row directory slice; employees without email are skipped. Backend resolves ALL_EMPLOYEES / BY_EMPLOYMENT_TYPE tenant-wide; BY_DEPARTMENT / BY_DESIGNATION by selected ids. Sends immediately, irreversible.

### Gaps & plan
- **Keep:** 4-step wizard with live recipient count and no-email warning, irreversible-send warning.
- **Add:**
  - [code] pagination (only page 0 fetched) and error state on the list; status filter.
  - [code] no scheduling / send-later, no test send to self.
  - [HANDOFF §12; STATUS "Important limits still open"] real provider delivery (mail/SMS) unverified locally — surface "provider accepted ≠ delivered" like OffersTab does.
  - [code: useDistribution.ts] `RecipientFilterType` includes `BY_COMPANY` but the wizard never offers it; multi-company tenants cannot target one company.
- **Change:** the wizard is a bespoke fixed panel with raw buttons — rebuild as `HrDrawer` with `HrButton`s; departments/designations are fetched for `companies[0]` only while counts are tenant-wide (mismatch in multi-company tenants); `EMPLOYMENT_TYPES` chips show "FULL TIME" — Title Case.

### Screenshot
`Attach: /hrms/letters/distributions — current screen`

### Claude Design prompt (ready to paste)
```
Design the Letter Distributions page (/hrms/letters/distributions) for HR_MANAGER / COMPANY_ADMIN. HrPageHeader crumb "Recruitment & Onboarding", title "Letter Distributions", subtitle "Send a letter to many employees in one action", action primary HrButton "+ New Distribution".
TableCard with FilterBar Status (Pending / Processing / Completed / Partial / Failed). Columns: Title "September 2026 Salary Slips", Template "Payslip Cover Letter", Recipients "142/148 sent · 6 failed" (show a small progress bar), Status pill (Pending=gray, Processing=info, Completed=ok, Partial=warn, Failed=red), Created "18 Sep 2026, 09:30". Rows open the job detail. HrPagination footer.
"+ New Distribution" opens HrDrawer "New Distribution" with a 4-step chip bar "1. Template · 2. Recipients · 3. Message · 4. Confirm". Step 1: Letter template select + "Subject preview" box with hint "Merge fields like {{employee.firstName}} are filled per recipient." Step 2: chips All employees / By department / By designation / By employment type / Custom list; sub-chips (Engineering, Sales… / Full Time, Part Time, Contract, Intern, Consultant); Custom list = searchable checkbox picker "Search employees…" rows "Priya Sharma (EMP-0142)" with amber "no email" tag; info box "This will send to 148 employees. 6 have no email on file and will be skipped." Step 3: Title* "e.g. November 2026 Salary Slips", Email subject (optional), Message to recipients textarea with hint "Sent in the email body above the attached document." Step 4: summary rows Template / Recipients "148 employees (6 skipped — no email)" / Title / Message + amber warning "This will send 142 emails immediately. This cannot be undone." Footer: ghost "Back", primary "Next" / "Send to 142 employees".
States: TableSkeleton; empty "No distributions yet — Send a letter (payslips, policy broadcasts…) to many employees at once."; add an error EmptyState with Retry.
```

---

## Distribution Detail  `/hrms/letters/distributions/:jobId`
- **File:** `modules/hrms/letters/DistributionDetail.tsx`  ·  **Sidebar:** not in sidebar / reached from Letter Distributions row or after Send  ·  **Roles:** route guard `anyOf [HRMS_LETTERS_DISTRIBUTE, HRMS_LETTERS_READ]`
- **Status:** LIVE — `useDistribution(jobId) → GET /v1/letters/distributions/{id}` polling every 3 s until terminal; `useRetryDistribution → POST /v1/letters/distributions/{id}/retry`.

### Purpose
Watch a bulk send progress live per recipient and retry the failed ones.

### Layout
1. Back link "← Distributions".
2. `HrPageHeader` — crumb "Letters" (inconsistent with siblings), title = job title, subtitle "Created dd MMM yyyy, HH:mm · ⟳ live" (spinner while not terminal); action primary `HrButton` "Retry Failed" (only when `failedCount > 0`, DISTRIBUTE perm).
3. Optional paragraph: `customMessage` with HTML stripped.
4. KPI strip (max-w-2xl, 3 cols) `HrStatCard`: **Sent** (green) · **Failed** (red) · **Pending** (orange = PENDING + GENERATING recipients).
5. `TableCard` > `hr-table`: **Email** (or italic "no email") · **Status** pill PENDING=gray, GENERATING=info, SENT=ok, FAILED=red, SKIPPED=warn · **Sent At** `dd MMM HH:mm` · **Error** (truncated red text, tooltip).

### Data shown
- Job: title, status, createdAt, customMessage, sentCount, failedCount, recipients[{id, email, sendStatus, sentAt, errorMessage}].

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| ← Distributions | top | navigate list | — | LIVE |
| Retry Failed | header (failedCount>0) | `POST /v1/letters/distributions/{id}/retry`; toast "Retrying N failed recipient(s)" / "Retry failed" | HRMS_LETTERS_DISTRIBUTE | LIVE |

### States
- Loading or missing job: `CardSkeleton` (a 404 never resolves into an error message — stays skeleton). Live polling badge while PENDING/PROCESSING. No empty-recipients state.

### Rules & permissions
- Retry only for jobs with failures and only with DISTRIBUTE. Polling stops at COMPLETED / PARTIAL_FAILURE / FAILED.

### Gaps & plan
- **Keep:** live polling badge, 3 stat cards, per-recipient error column.
- **Add:** [code] employee name/code per recipient (only email shown); overall job status pill in header; filter recipients by status; download of the generated letter per recipient.
- **Change:** crumb "Letters" → "Recruitment & Onboarding › Letter Distributions"; error/not-found state instead of infinite skeleton; Sent At lacks year.

### Screenshot
`Attach: /hrms/letters/distributions/:jobId — current screen`

### Claude Design prompt (ready to paste)
```
Design the Distribution Detail page (/hrms/letters/distributions/:jobId) for HR_MANAGER. Back link "← Distributions". HrPageHeader crumb "Recruitment & Onboarding › Letter Distributions", title "September 2026 Salary Slips", subtitle "Created 18 Sep 2026, 09:30 · live" with a spinning indicator while processing, actions: status pill "Processing" (info) + primary HrButton "Retry Failed" shown only when failures exist.
Optional message paragraph. KPI strip of 3 HrStatCard: Sent 142 (green) · Failed 6 (red) · Pending 0 (orange). TableCard toolbar FilterBar Status (Pending / Generating / Sent / Failed / Skipped). Columns: Employee (HrAvatar "Priya Sharma" sub "EMP-0142"), Email "priya@example.com" or italic "no email", Status pill (Pending=gray, Generating=info, Sent=ok, Failed=red, Skipped=warn), Sent At "18 Sep 2026, 09:31", Error (red truncated text with tooltip).
States: CardSkeleton while loading; error EmptyState "Failed to load distribution" + Retry + Back; empty recipients "No recipients in this job."
```

---

## Employee Vault (Employee Documents)  `/hrms/documents`
- **File:** `modules/hrms/DocumentVault.tsx` (hooks `modules/hrms/api/useDocument.ts`; embeds `letters/LetterTemplates.tsx`)  ·  **Sidebar:** Recruitment & Onboarding › Employee Vault (also any role with `hrms.letters.template.read`)  ·  **Roles:** R_HR; route guard `anyOf ['hrms.document.read.self','hrms.document.read','hrms.document.write','hrms.letters.template.read']` — EMPLOYEE with read.self sees only "My Documents"
- **Status:** LIVE — `useMyDocuments → GET /v1/document/my?page&size`, `useEmployeeDocuments → GET /v1/document/employee/{id}?page&size`, `useCreateDocument → POST /v1/document/upload` (multipart) or `POST /v1/document/documents` (URL), `useDeleteDocument → DELETE /v1/document/documents/{id}`. The "Letters & Contracts" tab reuses the live Letter Templates list.

### Purpose
The per-employee file store: employees view what HR holds on them; HR browses any employee's vault, uploads contracts/ID proofs/certificates with issue and expiry dates, deletes, and (via the last tab) reaches letter templates.

### Layout
1. `HrPageHeader` — crumb "Document Vault", title "Employee Documents", subtitle "Store, browse, and access employee documents". No actions.
2. `HrTabs` — **My Documents** (read.self) · **All Documents** (read) · **Upload** (write) · **Letters & Contracts** (letters.template.read). Default = first visible.

#### Tab: My Documents
3. Intro paragraph: "Your personal copy of the paperwork HR holds for you — offer letter, contract, ID proofs, certificates and tax documents. HR uploads them; you can view and download them here at any time."
4. KPI strip 3 `HrStatCard`: **Total Documents** (server total, blue) · **Expiring Soon** (≤30 d, orange, sub "On this page" when paged) · **Expired** (red, same).
5. `DocumentTable` (`TableCard` + `hrPaginationFooter` with page-size control): **Document** (title as external link + icon) · **Category** pill CONTRACT=purple, ID_PROOF=blue, CERTIFICATE=teal, PAYSLIP=green, POLICY=info, TAX=orange, OTHER=gray · **Issued** (hidden < sm) `d MMM yyyy` · **Expiry** date + pill "Expired" (red) / "Expires in Nd" (warn).

#### Tab: All Documents
6. `ut-card` with **Employee** select ("Select an employee…", "Name (EMP-0142)", first 200 of company[0]).
7. Dashed placeholder "Select an employee to browse their vault" until chosen; then `DocumentTable` with **Employee** column (`HrAvatar employeeName sub employeeCode`) + delete trash (write).

#### Tab: Upload
8. `ut-card` "Add employee document" (max-w-2xl): **Upload file** (PDF/PNG/JPEG ≤10 MB; hint "PDF, PNG or JPEG, up to 10 MB. Alternatively, use an existing document URL below."), **Employee *** select ("Select employee…"), **Title *** ("e.g. Employment contract 2026"), **Category** select (7 categories, default Contract), **Existing document URL (if no file)** ("https://…"), **Issued Date**, **Expiry Date**, **Notes** (rows 2, "Optional context"); footer primary `HrButton` "+ Store Document"/"Storing…".

#### Tab: Letters & Contracts
9. `<LetterTemplates embedded />` — the full Letter Templates page (its own `HrPageHeader` "Letter Templates" renders inside the tab).

### Data shown
- My: `GET /v1/document/my?page&size` (id, title, category, fileUrl, issuedDate, expiryDate, employeeName, employeeCode).
- All: `GET /v1/document/employee/{employeeId}?page&size`; employees `useEmployeeDirectory({companyId: companies[0], pageSize:200})`.
- Letters tab: `GET /v1/letters/templates`.

### Actions
| Label | Where | What happens | Roles allowed | Status |
|---|---|---|---|---|
| My Documents / All Documents / Upload / Letters & Contracts | HrTabs | switch (permission-filtered) | per tab | LIVE |
| Document title link | table | opens `fileUrl` in new tab | — | LIVE |
| Page / page-size controls | table footer | `hrPaginationFooter` | — | LIVE |
| Employee select | All tab | sets employeeId, resets page | hrms.document.read | LIVE |
| Delete document (trash) | All tab row | `window.confirm('Delete this document? This cannot be undone.')` → `DELETE /v1/document/documents/{id}`; toast "Document deleted" | hrms.document.write | LIVE |
| Upload file input | Upload tab | sets file | write | LIVE |
| Store Document | Upload tab | validations (employee, title, file or http(s) URL, ≤10 MB, expiry ≥ issued) → `POST /v1/document/upload` (multipart) or `POST /v1/document/documents`; toast "Document stored" / error message or "Failed to store document"; switches to All tab when the user has `hrms.document.read`, otherwise stays on Upload | hrms.document.write | LIVE |
| Letter Templates actions | Letters tab | see Letter Templates section | letters perms | LIVE |

### States
- Loading: KPI skeletons + 4 pulse rows. Empty (My): "Nothing shared with you yet — When HR uploads a document to your file — offer letter, contract, ID proof, certificate or tax form — it appears here. Ask HR if you are expecting something." Empty (All, chosen employee): "This employee has no documents yet — Use the Upload tab to add their offer letter, contract, ID proofs or certificates. Whatever you store here is visible to them under My Documents." (write) / "Nothing has been uploaded to their file yet." No employee chosen: "Select an employee to browse their vault".
- **No error state** on either document query (isError unhandled).
- Validation toasts: "Select an employee", "Give the document a title", "Choose a file or provide a document URL", "File must be at most 10 MB", "Enter a valid HTTP or HTTPS document URL", "Expiry date cannot precede issue date".

### Rules & permissions
- read.self → own vault only; read → any employee; write → upload/delete; letters.template.read → last tab. Expiry badges are computed client-side and therefore page-scoped (card sub-label says so).
- Upload is real multipart (`/v1/document/upload`) with a URL fallback — the BLUEPRINT/PLAN "URL paste box, no multipart endpoint" P0 is now addressed in code.
- Employee pickers are limited to `companies[0]` and 200 rows.

### Gaps & plan
- **Keep:** the explanatory My Documents intro, page-scoped expiry cards, multipart upload with URL fallback, honest empty-state copy.
- **Add:**
  - [BLUEPRINT §14 / PLAN §11] drag-drop + upload progress, permission-scoped download + audit trail ("Target: real file input, drag-drop, type/size validation, category, expiry tracking, permission-scoped download, audit trail") — only the file input/validation/expiry parts exist.
  - [BLUEPRINT §14, PLAN §11] "Separate Documents (uploaded files) from Letters (generated)" on the employee profile — the vault's own "Letters & Contracts" tab shows *templates*, not the employee's generated letters.
  - [code] server-side expiry aggregate (cards only count the current page); search by title; category/expiry filters; upload from All tab for the selected employee (today Upload is a separate tab with its own picker).
  - [HANDOFF §5 "Learning, performance, letters and reused modules"; §10 D; STATUS "Important limits still open"] "Employee-document R2 storage is separate from inspector's explicit local option. Do not infer all vault uploads now work without R2." — remote object storage is unverified locally; retention/cleanup policy still open.
- **Change:** crumb "Document Vault" ≠ sidebar label "Employee Vault" ≠ title "Employee Documents" — pick one; `window.confirm` → confirm Modal; embedding a whole page (with its own `HrPageHeader`) inside a tab produces a double header — link out instead or embed just the table; delete-only row actions — add "Download"/"Edit metadata".

### Screenshot
`Attach: /hrms/documents — current screen`

### Claude Design prompt (ready to paste)
```
Design the Employee Vault page (/hrms/documents) for HR_MANAGER (full) and EMPLOYEE (My Documents only). HrPageHeader crumb "Recruitment & Onboarding", title "Employee Vault", subtitle "Store, browse, and access employee documents", header action primary HrButton "+ Upload document" (opens an HrDrawer instead of a separate tab). HrTabs: My Documents · All Documents · Letters & Contracts.
My Documents: intro line "Your personal copy of the paperwork HR holds for you…"; KPI strip HrStatCard Total Documents 8 · Expiring Soon 1 (sub "On this page") · Expired 0. TableCard columns: Document ("Employment contract 2026" as link), Category pill (Contract=purple, ID Proof=blue, Certificate=teal, Payslip=green, Policy=info, Tax=orange, Other=gray), Issued "1 Apr 2026", Expiry "31 Mar 2027" + pill "Expires in 12d" (warn) / "Expired" (red), row action ghost "Download". Footer hrPaginationFooter with page-size.
All Documents: toolbar with searchable employee picker "Priya Sharma (EMP-0142)", search "Search title", FilterBar Category / Expiry; same columns plus Employee (HrAvatar) and ghost danger "Delete" (confirm Modal "Delete this document? This cannot be undone."). Placeholder before selection: "Select an employee to browse their vault".
Upload HrDrawer "Add employee document": drag-drop zone "PDF, PNG or JPEG, up to 10 MB", Employee*, Title* "e.g. Employment contract 2026", Category select, Existing document URL (if no file), Issued Date, Expiry Date, Notes; footer "Store Document".
Letters & Contracts: show the employee's generated letters table (not templates) with a link "Manage letter templates →".
States: skeleton rows; empty "Nothing shared with you yet — When HR uploads a document to your file — offer letter, contract, ID proof, certificate or tax form — it appears here."; "This employee has no documents yet — Use Upload to add their offer letter, contract, ID proofs or certificates."; add an error EmptyState with Retry.
```
