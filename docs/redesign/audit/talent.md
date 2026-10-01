# Phase 0 audit: Talent area (Hiring, Onboarding & assets, Letters, Employee vault, Docs to review)

- **Prototype:** `design_handoff_hrms_redesign/prototype/PgTalent.dc.html`, pages `h-pipe`, `h-onb`, `h-letters`, `h-vault`, `h-docs`, `me-letters`, `me-assets`. Nav model: `hrms-core.js` → `M.hiring` (Hiring & onboarding: Hiring, Onboarding & assets, Letters, Employee vault, Docs to review) and `M.me` (Letters, My assets). Every row, number and name in the prototype's `DCLogic` (`TL_CAND`, `TL_MYLET`, the inline arrays) is sample data.
- **Repo:** `C:\REACT\unifiedtree-saas`, `main` at `e32a4dc6`. Nothing was edited.
- **How this was checked:** code, routes (`App.tsx`), menu rules (`pageRegistry.ts`, `PlatformShell.tsx`), hooks, controllers and `@PreAuthorize`, and the Flyway migrations in `backend/app/hrms-app/src/main/resources/db/canonical`. The local API (port 8080) and the recovery database (port 55432) were **not running**, so no live GET or SQL checks were made, and nothing was started (read-only rule).
- **Status words:** **exists** = served today by the named hook or endpoint. **partial** = served, but something the design shows is missing (said in the row). **missing** = nothing in the backend provides it.

---

## 0. Summary

- All five admin pages and both "My" pages already exist, on `design/module/ModuleKit` with real APIs. The redesign here is mostly a re-skin plus a set of **small backend additions** (summary counts and name/department joins). No page is static today.
- **Real gaps:**
  - Hiring conversion rates and "time to hire" need candidate stage history. That history is not stored (the dashboard code says so), so this needs a **new table**.
  - Workspace-wide document counts (on file, expiring, expired, people) and the review queue's "verified / rejected this week" have no endpoint.
  - A candidate email stored on an offer, a letter "issue date", scheduled letter distributions ("Send on"), recipients by branch, letter e-signature ("Signed"), and a template's "Used by N hires" are all missing.
- **Design vs current behaviour: the biggest differences** (details in §11):
  - The Hiring pipeline is a drag-and-drop board today; the design shows a table.
  - The onboarding wizard's **Access** step is our roles-and-permissions picker; the design shows Work email, Slack and GitHub switches.
  - Two pages have a different tab order from the design, and Documents has a third view ("Letter templates") that the design drops.
  - Several one-click actions in the design need a reason or an input on the server today: Void a letter, Reject a document, Send an offer email.
- **Test risk is high:** 12 live scripts in `e2e/recovery` click today's labels and markup on these pages (§13).

---

## 1. Navigation and page access (today)

The rail group is `recruit`, labelled "Recruitment & Onboarding" in `PlatformShell.tsx` (rail label "Hiring"). The design calls it "Hiring & onboarding". Menus are permission-only: `isVisible()` → `menuRule(path, group)`. The `visibleForRoles` lists in `PlatformShell` are no longer read.

| Design page (prototype key) | Current menu link | Route(s) | Menu rule (pageRegistry / MENU_RULES) | Route guard (`App.tsx`) |
|---|---|---|---|---|
| Hiring (`h-pipe`) | Hiring Pipeline | `/hrms/hiring?tab=pipeline\|requisitions\|interviews\|offers` (+`&role=<reqId\|all>&stage=<STAGE>`) | registry `hiring`: anyOf `hrms.hiring.read`, `hrms.hiring.offer.read`, module `hrms` | anyOf `hrms.hiring.read`, `hrms.hiring.write`, `hrms.hiring.candidate.write`, `hrms.hiring.offer.read` |
| Onboarding & assets (`h-onb`) | Onboarding & Assets | `/hrms/onboarding/instances?view=hires\|assets\|templates`, `/instances/new`, `/instances/:instanceId`, `/hrms/onboarding` (templates alone), `/hrms/onboarding/templates/:id` | `recruit:/hrms/onboarding/instances`: anyOf `hrms.onboarding.instance.write`, `hrms.onboarding.asset.read`, `hrms.onboarding.template.read` | list/detail: anyOf `instance.read`, `task.complete`, `asset.read`; `/new`: `instance.write`; templates: `template.read` |
| Letters (`h-letters`) | Letters | `/hrms/letters/:view?` (`templates`, `generated`, `distributions`, `my`), `/hrms/letters/templates/:id` (incl. `new`), `/generated/:id`, `/distributions/:jobId`; `?employeeId=` opens Generate | registry `letters`: anyOf `hrms.letters.template.read`, `hrms.letters.read`, `hrms.letters.distribute` | hub: anyOf `template.read`, `letters.read`, `letters.read.self`, `letters.distribute`; editor: `template.read`; letter: `read`/`read.self`; distribution: `distribute`/`read` |
| Employee vault (`h-vault`) | Employee Vault | `/hrms/documents?view=my\|all\|letters` | `recruit:/hrms/documents`: anyOf `hrms.document.read`, `hrms.letters.template.read` | anyOf `document.read.self`, `document.read`, `document.write`, `letters.template.read` |
| Docs to review (`h-docs`) | Docs to Review | `/hrms/documents/pending` and the old bell link `/documents/pending` | registry `docs-review`: `hrms.document.verify` | `hrms.document.verify` |
| My letters (`me-letters`) | Me → Letters | `/hrms/letters/my` | registry `me-letters`: `hrms.letters.read.self` | as the Letters hub |
| My assets (`me-assets`) | Me → My assets | `/me/assets` | registry `me-assets`: `hrms.onboarding.asset.self`, `self: true` | `hrms.onboarding.asset.self` |
| (not in design) My interviews | none in the rail (a workspace shortcut and the bell) | `/me/interviews` | registry `me-interviews`: anyOf `hrms.hiring.interview.self`, `hrms.hiring.read` | same |

- The **Me group (`ess`) is hidden** for OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN (`administersWorkspace` in `PlatformShell.isVisible`). So those roles do not get "My assets" or Me → Letters in the rail, although they hold the permissions.
- **Search registry tabs** (`pageRegistry.ts`, one per tab of these pages):
  - `hiring:pipeline`, `hiring:requisitions`, `hiring:interviews`: `hrms.hiring.read`.
  - `hiring:offers`: `hrms.hiring.offer.read`.
  - `onboarding:hires`: anyOf `instance.read` plus allOf `instance.write`.
  - `onboarding:assets`: anyOf `asset.read`, `instance.write`.
  - `onboarding:templates`: `template.read`.
  - `documents:all`: `hrms.document.read`.
  - `me-documents`: `hrms.document.read.self`, path `/hrms/documents?view=my`.
- **Search actions** (`shared/search/actionRegistry.ts`):
  - `new-requisition`: allOf `hiring.write`, `hiring.read`.
  - `start-onboarding`: `instance.write`.
  - `generate-letter`: allOf `letters.generate`, `letters.read`.
  - `review-documents`: `document.verify`.
  - `upload-document`: allOf `document.write.self`, `document.read.self`, path `/hrms/documents?view=my`. That page has no upload control today (see G21).
- **Inbound links that must keep working:**
  - Dashboard: `/hrms/hiring?tab=pipeline&role=all&stage=X&company=<id>` and `/hrms/hiring?tab=requisitions`. The page ignores `company=`, and old `?tab=candidates` links fall back to Pipeline.
  - Backend notifications and search: `/hrms/hiring?tab=pipeline&role=`, `/hrms/hiring?tab=offers`, `/hrms/documents?view=my|all`, `/hrms/letters/generated/<id>`, `/hrms/letters/distributions/<id>`, `/me/interviews`, `/hrms/onboarding/instances/<id>`, `/documents/pending`.
  - Employee profile: `/hrms/letters/generated?employeeId=` and `/hrms/letters?employeeId=`.

---

## 2. Hiring (`PgTalent.dc.html` → `h-pipe`)

**Maps to:** `apps/platform/src/modules/hrms/Hiring.tsx` (the Pipeline and Requisitions tabs), `hiring/Interviews.tsx` (`InterviewsTab`, `CandidateDrawer`, `ScheduleInterviewDrawer`, `ScorecardDrawer`, `MyInterviews`), `hiring/OffersTab.tsx`, and the hooks in `modules/hrms/api/useHiring.ts`. Backend: `HiringController`, `InterviewController`/`InterviewService`, `OfferDocumentController`, `OfferDeliveryController`, `HiringService`, `CandidateConversionService`, `ConversionOnboardingStarter`. The page exists.

**Tabs:**

| | Design | Current (`?tab=`) |
|---|---|---|
| 1 | Pipeline | `pipeline` |
| 2 | Requisitions | `requisitions` |
| 3 | Interviews | `interviews` |
| 4 | Offers | `offers` |

Same names and order. The first three need `hrms.hiring.read`; Offers needs `hrms.hiring.offer.read` (`Hiring.tsx` `usePermission`).

**In-page views in the design:**
- Add a candidate
- Open or Edit requisition
- Schedule interview
- Scorecard
- Create or Edit offer

Today these are drawers (`HrDrawer`) or inline panels.

### 2.1 Data points

| # | Tab | Design shows | Source today | Status |
|---|---|---|---|---|
| P1 | Pipeline | Stat "Open" (open requisitions) | `useRequisitions(0)` → `GET /v1/hiring/requisitions?page=0&size=20`, counted in the browser | **partial**: counts only the first 20 requisitions (the tile says "On this page"). `GET /v1/admin/dashboard/hiring?companyId=` has `openJobs`, but per company |
| P2 | Pipeline | Stat "Positions to fill" (openings on open and on-hold roles) | same, summed in the browser | **partial**: first 20 only |
| P3 | Pipeline | Stat "Candidates · This quarter" | none. `GET /v1/hiring/candidates` returns `createdAt` but stops at 1,000 rows | **missing** |
| P4 | Pipeline | Stat "Closed" | same as P1 | **partial**: first 20 only |
| P5 | Pipeline | Bars "Pipeline by stage · Every open role" (Applied…Hired counts) | `useCandidateBoard` (browser counts) or `/v1/admin/dashboard/hiring` `stages` | **partial**: the dashboard endpoint is per company and includes closed roles; the board is capped at 1,000 |
| P6–P9 | Pipeline | Conversion Applied→Screening, Screening→Interview, Interview→Offer, Offer→Hired (%) | none. No stage history is stored (see the comment in `AdminDashboardController.hiring`) | **missing** |
| P10 | Pipeline | "Time to hire: N days on average" | none (no hired-at time; `converted_at` is set only on conversion) | **missing** |
| P11–P16 | Pipeline | Candidate name, role, stage pill, source, expected CTC, applied date | `useCandidateBoard` → `GET /v1/hiring/candidates?requisitionId&stage` (`fullName`, `requisitionTitle`, `stage`, `source`, `expectedCtc`, `createdAt`) | **exists** |
| P17 | Pipeline | Stage filter (All stages, Applied, Screening, Interview, Offer, Hired) | `?stage=` → same endpoint | **exists**. Rejected and Withdrawn exist too and are not in the design |
| R1–R6 | Requisitions | Job title, openings, location, type, candidates, status | `useRequisitions` (`title`, `openings`, `location`, `employmentType`, `candidateCount`, `status`) | **exists**. Only the first page (20) is loaded; there is no pager |
| I1 | Interviews | Stat "Coming up" | `useUpcomingInterviews` → `GET /v1/hiring/interviews` | **exists** |
| I2 | Interviews | Stat "Today · India time" | same, `scheduledAtIst` | **exists** |
| I3 | Interviews | Stat "Your scorecards due" | `useMyInterviews` → `GET /v1/hiring/interviews/mine` (started, no scorecard) | **exists** |
| I4 | Interviews | Stat "Interviews you took · This quarter" | `/interviews/mine` returns only upcoming ones and the last 60 days | **partial** |
| I5–I9 | Interviews | Candidate · role, interview name, when (IST) + length, interviewers, status pill (Today / Scheduled / Scorecard due / Scorecard in) | `Interview` DTO (`candidateName`, `roleTitle`, `title`, `scheduledAtIst`, `durationMinutes`, `interviewers[]`, `started`, `scorecards`) | **exists** (the status is worked out in the browser) |
| O1 | Offers | Candidate name | `useHiringOffers(page)` → `GET /v1/hiring/offers` | **exists** |
| O2 | Offers | Candidate email under the name | `emailRecipient` only after an email was sent. No stored candidate email; a linked candidate's email is not returned | **partial** |
| O3–O6 | Offers | Role, offered CTC, joining date, status | `roleTitle`, `offeredCtc`, `joiningDate`, `status` | **exists** |
| F1 | Add candidate | Role options | `useRequisitions(0)` | **partial**: first 20 requisitions |
| F2 | Schedule interview | Candidate options (Screening or Interview) | `GET /v1/hiring/candidates?stage=` (called twice, or filtered in the browser) | **exists** (not used this way yet) |
| F3 | Schedule interview | Interviewers (up to 10) | `PerformanceEmployeePicker` (employee directory) | **exists** |
| F4 | Scorecard | Candidate, role, interview, date, criteria | `Interview.criteria` etc. | **exists** |
| F5 | Offer form | Company options | `useCompanies()` (active companies only) | **exists** |
| F6 | Requisition form | Location as a list | free text in the backend (`location VARCHAR(150)`); `useBranches` exists | **partial**: build the list from branches plus free text, never a fixed list of cities |

### 2.2 Actions

| # | Design action | API today | Permission (`@PreAuthorize` / `usePermission`) | Status |
|---|---|---|---|---|
| A1 | Add a candidate (main button → form) | `POST /v1/hiring/requisitions/{id}/candidates` | `hrms.hiring.candidate.write` | **exists** (today an inline panel after picking a role) |
| A2 | Pick the starting stage (Applied/Screening/Interview/Offer) | `HiringService.addCandidate` always sets `APPLIED`; stages cannot be skipped (`assertTransitionAllowed`) | none | **missing** (and it conflicts with a server rule, §11) |
| A3 | "Move to <next stage>" | `PUT /v1/hiring/candidates/{id}/stage` | `hrms.hiring.candidate.write` | **exists** |
| A4 | "Create employee" on Hired | `POST /v1/hiring/candidates/{id}/convert` | `hrms.hiring.candidate.write` **and** `hrms.employee.write`. Onboarding starts only if the token has `hrms.onboarding.instance.write` | **exists** |
| A5 | Stage filter | `?stage=` | as the tab | **exists** |
| A6 | Open requisition | `POST /v1/hiring/requisitions` | `hrms.hiring.write` | **exists** (no Description on create today; the API takes it) |
| A7 | Edit requisition | `GET` + `PUT /v1/hiring/requisitions/{id}` (a full replace) | `hrms.hiring.write` | **exists** |
| A8 | Close requisition | `POST /v1/hiring/requisitions/{id}/close` | `hrms.hiring.write` | **exists** |
| A9 | Schedule interview (page-level, with a candidate picker) | `POST /v1/hiring/candidates/{id}/interviews` | `hrms.hiring.interview.write` | **partial**: the API exists; today you schedule only from a candidate's drawer (the page-level picker is front-end work) |
| A10 | Copy link | the interview's `location` (video link) | as the tab | **exists** (front end only) |
| A11 | Fill scorecard | `PUT /v1/hiring/interviews/{id}/scorecard` | anyOf `hrms.hiring.interview.self`, `hrms.hiring.read`; the server checks assignment and that the interview has started | **exists** |
| A12 | Create offer (Save draft) | `POST /v1/hiring/offers` | anyOf `hrms.hiring.offer.write`, `hrms.hiring.write` | **exists** |
| A13 | Edit draft | `PUT /v1/hiring/offers/{id}` | same | **exists** |
| A14 | Download PDF | `GET /v1/hiring/offers/{id}/pdf` | `hrms.hiring.offer.read` | **exists** |
| A15 | Send offer email (one click) | `POST /v1/hiring/offers/{id}/email` needs `recipient` (`@NotBlank @Email`) | anyOf `offer.write`, `hiring.write` | **partial**: needs a stored candidate email (G4); until then the form must ask for it |

**Current behaviour the design does not show. Keep it** (the rule: do not remove features):
- The board's drag and drop, and the role filter (`?role=`, "All roles").
- Reject and Withdraw (in the "Move to" list).
- "Interviews & scorecards" candidate drawer: facts, scorecard summary, per-interview blocks.
- Next-interview and scorecard lines on each card.
- "View employee →" after conversion.
- Reschedule and Cancel interview (`PUT /v1/hiring/interviews/{id}`, `POST /v1/hiring/interviews/{id}/cancel`, `hrms.hiring.interview.write`), and "Open pipeline".
- Interview mode (in person, video, phone) and the place or link. The server requires the link for video (`INTERVIEW_LINK_REQUIRED`).
- Offer status changes: Mark as sent, Accepted, Declined, Withdrawn (`POST /v1/hiring/offers/{id}/status`).
- "Submitted to <email> <time>".
- Offers paging.
- Unused today: `GET /v1/hiring/offers/{id}/email/attempts` and `POST …/attempts/{id}/resolve` exist on the server, but no screen calls them.

---

## 3. Onboarding & assets (`h-onb`)

**Maps to:** `modules/hrms/onboarding/`:
- `Instances.tsx` (the page, the HR "New hires" view and the employee's "Your onboarding" view)
- `AssetsTab.tsx`, `AssetHistory.tsx`
- `Templates.tsx`, `TemplateDetail.tsx`
- `InstanceDetail.tsx`, `HireDetails.tsx`
- `OnboardingForm.tsx` (the 9-step wizard, 1,998 lines) and `OnboardingRecord.tsx`
- `api/useOnboarding.ts`, `api/useAssets.ts`

Backend: `OnboardingController`, `OnboardingService` (in `modules/hrms-employee`), `OnboardingHireDetailsService`, `OnboardingRecordController`, `MyAssetsController`. The page exists.

**Tabs (in a different order):**

| | Design | Current (`?view=`) |
|---|---|---|
| 1 | New hires | `hires` ("Your onboarding" for non-HR) |
| 2 | Checklist templates | `assets` |
| 3 | Assets | `templates` |

- New hires: `hrms.onboarding.instance.read`, HR view when `instance.write`.
- Assets: `asset.read` or `instance.write`.
- Checklist templates: `template.read`.

**Wizard steps:** Basic Details, Employment, Documents, Payroll, Benefits, Policies, Assets, Access, Joining. These are the **same 9 steps** as `OnboardingForm.STEPS`. Access is shown only when the person holds `workspace.users.read` and either `workspace.users.manage` or `rbac.access.manage-overrides` (`useNewPersonAccessRights`).

### 3.1 Data points

| # | Tab | Design shows | Source today | Status |
|---|---|---|---|---|
| N1 | New hires | Stat "In progress" | `useInstances()` → `GET /v1/onboarding/instances` (HR: all; others: their own) | **exists** (today's tiles are All / In progress / Completed / On hold) |
| N2 | New hires | Stat "Joining this month" | the employee's `dateOfJoining` via `useEmployeesByIds` (needs `hrms.employee.read`). The run itself stores no joining date | **partial** |
| N3 | New hires | Stat "Tasks overdue" | `instanceTasks[].dueDate` and `status` in the list response | **exists** (counted in the browser) |
| N4 | New hires | New hire name | `useEmployeesByIds` (`hrms.employee.read`); a dash without it | **partial** |
| N5 | New hires | Department (after the name) | `useDepartments(companies[0].id)`: **the first company's departments only** | **partial** (wrong for other companies) |
| N6 | New hires | Joining date | employee `dateOfJoining`, else `startedAt` | **partial** (needs `employee.read`) |
| N7 | New hires | Template name | the run has `templateId` only; names need `useTemplates` (`template.read`) | **partial** |
| N8 | New hires | Progress "x of y tasks" | `instanceTasks` | **exists** |
| N9 | New hires | Status (Starts Monday / In progress / Done) | `status` plus joining date (worked out) | **exists** (On hold exists too) |
| T1, T2, T4 | Templates | Name, task count, Active/Archived | `useTemplates()` → `GET /v1/onboarding/templates` (tasks included) | **exists** |
| T3 | Templates | "Used by N hires" | none | **missing** |
| S1–S3 | Assets | All assets, With employees, In store | `useAssets` → `GET /v1/onboarding/assets` (no paging) | **exists** |
| S4, S5, S8 | Assets | Tag · name, category, status | `assetTag`, `assetName`, `assetType`, `status` | **exists**. The design shows returned items as "In store"; today they show "Returned" |
| S6 | Assets | "With" (holder's name) | `employeeId` → `useEmployeesByIds` (`hrms.employee.read`); otherwise "An employee" | **partial** |
| S7 | Assets | Dates: "Since…", "Returned 18 Sep · good condition", "Returned by <name>", "Ready for Mon, 28 Sep" | `assignedAt`, `returnedAt`, `conditionNotes`; `employeeId` is kept after a return | **partial**: "Returned by" needs the name (G9). "Ready for <date>" (keeping an asset for a future joiner) does not exist anywhere (G10) |
| V1 | Record view | Joining checklist: task, owner, status | `GET /v1/onboarding/instances/{id}/tasks` (`ownerRole`, `status`); also the supplementary record's `joiningChecklist` | **exists** |
| V2, V3 | Record view | Recorded asset issues; policies selected for the hire | `GET /v1/hrms/employees/{id}/onboarding-record` | **exists**, but only with `hrms.employee.write` (the controller's rule) |
| V4, V5 | Template view | Tasks (task, due, owner role, required); owner role options | `GET /v1/onboarding/templates/{id}`, `GET /v1/onboarding/owner-roles` | **exists** |
| V6 | Wizard | Departments, branches, designations, employment types, managers, policies, templates, next employee code, salary components | `useDepartments/useBranches/useDesignations/useEmploymentTypes(companies[0])`, `useEmployeeDirectory`, `usePolicies(0,'ACTIVE')`, `useTemplates`, `useNextEmployeeCode`, `useSalaryComponents` | **exists**. Only the first company is used, and only the first page of policies |
| V7 | Wizard | Documents step list (PAN, Aadhaar, Degree, …) | a hard-coded `DOCUMENT_ROWS` list (6 rows), not the workspace's document types (`GET /v1/document/types`) | **partial** (a fixed list) |
| V8 | Wizard | Assets step: "Add asset: pick an asset from the store" | today: free-text rows saved in the onboarding record (JSON), not linked to the asset register | **missing** |

### 3.2 Actions

| # | Design action | API today | Permission | Status |
|---|---|---|---|---|
| B1 | Start onboarding | route `/hrms/onboarding/instances/new` | `hrms.onboarding.instance.write` (route guard and button) | **exists** |
| B2 | Wizard Back / Continue | front end (draft kept in local storage) | none | **exists** (labels are "Next" and "Create Employee" today) |
| B3 | Wizard "Create employee" | `POST` employee (`useCreateWorkforceEmployee`, `hrms.employee.write`) → `POST /v1/onboarding/instances` (`instance.write`) → `PUT /v1/hrms/employees/{id}/onboarding-record` (`employee.write`) → bank account `POST /v1/employees/{id}/profile/bank-accounts` → payroll (`payroll.structure.manage`) → document uploads (`hrms.document.write`) → invite (`hrms.employee.invite`) → access | as listed | **exists** |
| B4 | Wizard "Add asset" from the store | would be `GET /v1/onboarding/assets` plus `POST /v1/onboarding/assets/{id}/assign` (with `onboardingInstanceId`). The server refuses a future assignment date (`ASSET_DATE_INVALID`) | `asset.write` or `instance.write` | **missing** (§11 and question Q7) |
| B5 | Wizard Access switches (Work email, Slack, GitHub, HRMS app role) | only the RBAC `AccessPicker` (roles, single permissions, login invite) | `workspace.users.*`, `rbac.access.manage-overrides` | **missing** as designed (question Q6) |
| B6 | Open record | `/hrms/onboarding/instances/{id}` | `instance.read` | **exists** |
| B7 | New template | `POST /v1/onboarding/templates` | `hrms.onboarding.template.write` | **exists** |
| B8 | Edit template (name, description, active) | `PUT /v1/onboarding/templates/{id}` | `template.write` | **exists** |
| B9 | Archive template | `DELETE /v1/onboarding/templates/{id}` (archives) | `template.write` | **exists** |
| B10 | Add a task | `POST /v1/onboarding/templates/{id}/tasks` | `template.write` | **exists** |
| B11 | Delete task | `DELETE /v1/onboarding/templates/{id}/tasks/{taskId}` | `template.write` | **exists** |
| B12 | Due "Before joining" / "On the joining day" | the backend accepts any `due_offset_days`; the drawer input has `min={1}` | `template.write` | **partial** (front end only) |
| B13 | Register an asset | `POST /v1/onboarding/assets` | anyOf `asset.write`, `instance.write` | **exists** (Category is free text; the design shows a list) |
| B14 | Give to | `POST /v1/onboarding/assets/{id}/assign` | same | **exists** (button label "Assign" today) |
| B15 | Take back | `POST /v1/onboarding/assets/{id}/return` | same | **exists** |
| B16 | Status filter (All / With employee / In store) | front end | none | **exists** (a select today) |

**Keep, although the design does not show it:**
- Asset History: `GET /v1/onboarding/assets/{id}/history`.
- Asset search.
- Put on hold, Resume, Reopen: `PATCH /v1/onboarding/instances/{id}/status`, `instance.write`.
- Mark done and Skip on tasks: `POST /v1/onboarding/instance-tasks/{id}/complete|skip`, `task.complete`.
- Task notes.
- Move up / Move down on template tasks: `PUT /v1/onboarding/templates/{id}/tasks/order`.
- Task description.
- Hire details panel and editing (`GET/PUT /v1/onboarding/instances/{id}/hire-details`).
- The employee's own "Your onboarding" view.
- Status filter and paging on New hires.
- The row menu: Open employee profile, Open template.

---

## 4. Letters (`h-letters`)

**Maps to:** `modules/hrms/letters/`:
- `LettersHub.tsx`, `lettersView.ts`
- `LetterTemplates.tsx`, `LetterTemplateEditor.tsx` (tiptap)
- `GeneratedLetters.tsx`, `GeneratedLetterDetail.tsx`, `GenerateLetterDrawer.tsx`
- `Distributions.tsx`, `DistributionWizard.tsx`, `DistributionDetail.tsx`
- `api/useLetters.ts`, `api/useDistribution.ts`

Backend: `LetterController`, `LetterDistributionController`/`Service`/`Processor`, `LetterGenerationService`, `MergeFieldResolver`. The page exists.

**Tabs:** design Templates, Generated letters, Distributions, My letters. The current path views are `templates`, `generated`, `distributions`, `my`: **same order and names**. Rules (`lettersView.letterViews`):
- Templates: `template.read`.
- Generated letters: `letters.read`.
- Distributions: `distribute` or `read`.
- My letters: `read.self`.

### 4.1 Data points

| # | Tab | Design shows | Source today | Status |
|---|---|---|---|---|
| L1–L4 | Templates | Name, type, last updated, Active/Inactive | `useLetterTemplates(page)` → `GET /v1/letters/templates` | **exists** |
| L5 | Generated | Employee name | `useGeneratedLetters` → `GET /v1/letters/generated` (`employeeName`, `employeeCode`) | **exists** |
| L6 | Generated | Employee department ("Aisha Khan · Design") | not in `GeneratedLetterDto` | **missing** (G12) |
| L7 | Generated | Letter (template name, e.g. "Appointment letter") | `type` + `subject` only; `templateId` has no name | **partial** |
| L8 | Generated | Issued date | `createdAt` / `sentAt` | **exists** |
| L9 | Generated | Status (Draft / Sent / Void) | `status`: GENERATED / SENT / VOID | **exists** (GENERATED shows as "Generated" today) |
| L10, L12, L13 | Distributions | Name, recipient count, sent date | `useDistributions` → `GET /v1/letters/distributions` (`title`, `totalRecipients`, `createdAt`/`completedAt`) | **exists** |
| L11 | Distributions | Letter (template name) | `templateId` only | **partial** |
| L14 | Distributions | "Delivered to 212" / "246 delivered · 3 bounced" | `sentCount`, `failedCount` (mail-service acceptance, not delivery) | **exists**, but the wording must say "sent" and "failed" (§11) |
| L15, L16 | My letters | Letter, issued | `useMyLetters` → `GET /v1/letters/my` | **exists** |
| L17 | My letters | Status (Issued / Signed) | no signing exists. `/my` also returns HR's **unsent drafts and voided letters** (`findActiveByEmployeeId` only filters deleted ones) | **partial** |
| L18 | Template editor | Name, letter type, subject, body | `GET/POST/PUT /v1/letters/templates` | **exists**. A new template uses `companies[0]` |
| L19 | Template editor | "Insert field" list | `GET /v1/letters/merge-fields` (`{{employee.fullName}}` style) | **exists**. The design's `{employee_name}` tokens are sample text |
| L20 | Generate | Template and employee choice | `useLetterTemplates` + `useEmployeeDirectory` (`hrms.employee.read`) | **exists** |
| L21 | Generate | Issue date | none. The letter date comes from `today` (`MergeFieldResolver`); overrides exist but no issue-date field | **missing** (G15) |
| L22 | New distribution | Recipients (Everyone / department / … / "Bengaluru HQ") | `RecipientFilter`: ALL_EMPLOYEES, BY_COMPANY, BY_DEPARTMENT, BY_DESIGNATION, BY_EMPLOYMENT_TYPE, CUSTOM_LIST | **partial**: no by-branch filter |
| L23 | New distribution | "Send on" date | none. A distribution runs straight away (`@Async`) | **missing** (G14) |

### 4.2 Actions

| # | Design action | API today | Permission | Status |
|---|---|---|---|---|
| C1 | Create template | route `/hrms/letters/templates/new` → `POST /v1/letters/templates` | `hrms.letters.template.create` | **exists** |
| C2 | Edit | `PUT /v1/letters/templates/{id}` | `hrms.letters.template.update` | **exists** |
| C3 | Delete | `DELETE /v1/letters/templates/{id}` | `hrms.letters.template.delete` | **exists** |
| C4 | Save template | same as C1/C2 | same | **exists** |
| C5 | Preview as employee | `POST /v1/letters/templates/{id}/preview` | `hrms.letters.template.read` | **exists** (only after the first save) |
| C6 | Generate letter ("Send by email: yes / keep as draft") | `POST /v1/letters/generate` (`sendImmediately`, `sendToEmail` are supported; the drawer always sends `false` today) | `hrms.letters.generate` | **exists** |
| C7 | Send | `POST /v1/letters/generated/{id}/send` | `hrms.letters.send` | **exists** (on the letter page today) |
| C8 | Download | `GET /v1/letters/generated/{id}/pdf` | `letters.read` or `letters.read.self` (owner check) | **exists** |
| C9 | Void | `POST /v1/letters/generated/{id}/void` (reason required, `@NotBlank`) | `hrms.letters.void` | **exists** (the design shows it as one click) |
| C10 | New distribution | `POST /v1/letters/distributions` | `hrms.letters.distribute` | **exists** (a 4-step wizard today) |
| C11 | Schedule a distribution ("Send on") | none | none | **missing** |
| C12 | My letters · Download | as C8 | `read.self` | **exists** |

**Keep:**
- Delete letter (`DELETE /v1/letters/generated/{id}`, `hrms.letters.delete`).
- Send with To and CC.
- The distribution page: tiles "Still to send…", polling every 3 seconds, Retry (`POST /v1/letters/distributions/{id}/retry`, `distribute`).
- `?employeeId=` opens Generate.
- Old `/generated` links open My letters for self-only readers.

---

## 5. Employee vault (`h-vault`)

**Maps to:** `modules/hrms/DocumentVault.tsx` and `modules/hrms/api/useDocument.ts`. Backend: `DocumentController`, `DocumentUploadController`, `DocumentTypeController`, `DocumentService`. The page exists.

**Tabs:**

| | Design | Current (`?view=`) |
|---|---|---|
| 1 | Employee documents | `my` (My documents, `document.read.self`) |
| 2 | My documents | `all` (Employee documents, `document.read`) |
| 3 | (none) | `letters` (Letter templates, `letters.template.read`) |

The design drops the third view, and the first two are in a different order.

### 5.1 Data points

| # | Tab | Design shows | Source today | Status |
|---|---|---|---|---|
| D1 | Employee documents | "Across 249 people" | `useEmployeeCounts()` → `GET /v1/hrms/employees/counts` (needs employee read) | **partial** (not used here today) |
| D2–D4 | Employee documents | On file, Expiring soon (30 days), Expired, **for the whole workspace** | none. Today's tiles count only the picked person, and only the page on screen | **missing** (G18) |
| D5 | Employee documents | Waiting for review | `usePendingDocumentQueue` → `GET /v1/document/pending` (row count; at most 200) | **partial**: needs `hrms.document.verify`; hide the tile without it |
| D6 | Employee documents | "Whose file?" picker | `PerformanceEmployeePicker` | **exists** |
| D7 | Employee documents | The person's department | the employee record (`useWorkforceEmployee`), not shown today | **partial** |
| D8 | Employee documents | The person's count on file | `totalElements` of `GET /v1/document/employee/{id}` | **exists** |
| D9 | Employee documents | The person's expired documents (names) | worked out in the browser from the page on screen | **partial** |
| D10–D14 | Employee documents | Document, type, issued, expiry, review | `useEmployeeDocuments` (`title`, `documentTypeName`/`category`, `issuedDate`, `expiryDate`, `verificationStatus`) | **exists** |
| D15 | My documents | On file | `useMyDocuments` → `GET /v1/document/my` `totalElements` | **exists** |
| D16, D17 | My documents | Expiring soon; Expired (with the document's name) | worked out from the page on screen | **partial** |
| D18 | My documents | Document, issued, expiry, review | `useMyDocuments` | **exists** |
| D19 | Add / Bulk upload | Document type options | `useDocumentTypes` → `GET /v1/document/types` (`hrms.document.type.read`) | **exists** |

### 5.2 Actions

| # | Design action | API today | Permission | Status |
|---|---|---|---|---|
| E1 | Add document | `POST /v1/document/upload` (file) or `POST /v1/document/documents` (link). HR uploads land Verified | `hrms.document.write` | **exists** (submit label "Store document" today) |
| E2 | Bulk upload | `POST /v1/document/upload`, once per file | `hrms.document.write` | **exists** |
| E3 | Edit | `PUT /v1/document/documents/{id}` (JSON or multipart) | `hrms.document.write` | **exists** |

**Keep:**
- Delete (`DELETE /v1/document/documents/{id}`, anyOf `document.write`, `document.write.self`).
- The signed file links, and the "File can't be opened here" note.
- The rejection reason on rejected rows.
- Paging and page size.

**Worth adding:** self-upload on "My documents" (the endpoint `POST /v1/document/upload/self` exists, `hrms.document.write.self`, and lands Pending). Today it is only on `/profile` (`pages/MyDocumentsCard.tsx`), yet the ⌘K action "Upload a document" opens `/hrms/documents?view=my`.

---

## 6. Docs to review (`h-docs`)

**Maps to:** `pages/PendingDocuments.tsx` (decision cards) and `useDocument.ts`. Backend `DocumentController` (`/pending`, `/documents/{id}/verify`, `/documents/{id}/reject`). The page exists. It has no tabs, so the header shows a single solid pill.

| # | Design shows | Source today | Status |
|---|---|---|---|
| R1 | Stat "Waiting for review" | `GET /v1/document/pending` row count (at most 200) | **exists** |
| R2 | Stat "Verified this week" | none. The `verified_at` column exists (set on verify and reject; HR uploads have none) | **missing** |
| R3 | Stat "Rejected this week" | none (same column) | **missing** |
| R4 | Employee name | `employeeName` | **exists** |
| R5 | Department | not in the queue query | **missing** |
| R6 | Document | `title`, `documentTypeName` | **exists** |
| R7 | Uploaded | `createdAt` | **exists** |
| R8 | Expiry | the `expiry_date` column exists but the queue query does not select it | **missing** |

| # | Design action | API | Permission | Status |
|---|---|---|---|---|
| E4 | Verify | `POST /v1/document/documents/{id}/verify` | `hrms.document.verify` | **exists** |
| E5 | Reject | `POST /v1/document/documents/{id}/reject`, reason 3–500 characters, and the employee is notified | `hrms.document.verify` | **exists** (the design shows one click, but the reason is required) |

**Keep:**
- "View file" (fetches a signed link through `GET /v1/document/documents/{id}`).
- File name and size.
- "Open their documents →".
- Refresh.

---

## 7. My letters (`me-letters`)

**Maps to:** `LettersHub` view `my` (`/hrms/letters/my`; crumb "My workspace", title "My letters" when it is the only view) and `GeneratedLettersList mine`.

| Design shows | Source | Status |
|---|---|---|
| Letter | `GET /v1/letters/my`: `subject`/`type` | **exists** |
| Issued | `createdAt`/`sentAt` | **exists** |
| Status (Issued / Signed) | `status`; there is no signing, and drafts and voided letters are included | **partial** |

**Action:** Download (`GET /v1/letters/generated/{id}/pdf`, `hrms.letters.read.self` plus the owner check). **Exists.**

---

## 8. My assets (`me-assets`)

**Maps to:** `onboarding/MyAssets.tsx` at `/me/assets`, using `useMyAssets` → `GET /v1/me/assets` (`hrms.onboarding.asset.self`).

| Design shows | Source | Status |
|---|---|---|
| With you | `withMe` count | **exists** |
| Returned | `!withMe` count | **exists** |
| Asset tag · name | `assetTag`, `assetName` | **exists** |
| Category | `assetType` | **exists** |
| Since / Returned date | `assignedAt`, `returnedAt` | **exists** |
| Status | `withMe` | **exists** |

No actions in PgTalent.

The self-service `EmpDocs.dc.html` adds "Yes, I have it" and "Report a problem" to assets, and "Review and sign" to letters. Those belong to the self-service Documents audit. Their backend needs are listed as G19 and G20 because they touch this area's tables.

---

## 9. Pages the design does not draw but that must stay

- `/me/interviews` (`MyInterviews`): an employee's interviews and their scorecard. The bell and the workspace shortcut open it.
- `/hrms/onboarding/instances/:id` for the new hire themselves ("Your onboarding", Mark done / Skip).
- `/hrms/letters/generated/:id` (letter page: Send, Void, Delete, PDF).
- `/hrms/letters/distributions/:jobId`.
- `/hrms/letters/templates/:id` (full-page editor with preview).
- `/hrms/onboarding` (templates alone).
- `/documents/pending` (old bell link).

Restyle these with the same shared pieces.

---

## 10. Gaps: backend work

"Schema change" means a new table or column. "JPA maps the table" says whether an existing JPA entity maps it. Per DECISIONS §2, new columns on JPA-mapped tables must stay **unmapped** and be read and written with `JdbcTemplate` only. Every new block must hide or show an empty state until its migration is applied. Any new permission must be granted to OWNER and SUPER_ADMIN in its migration (`OwnerPermissionInvariantCheck`). Sizes: S = under a day, M = one to three days, L = more.

| # | What | Backend work | Schema change | JPA maps the table? | Size |
|---|---|---|---|---|---|
| G1 | Hiring summary: open / on-hold / closed requisitions, positions to fill, candidates this quarter, stage counts for open roles (P1–P5) | `GET /v1/hiring/summary?companyId=` (JDBC counts on `hiring_mgmt.job_requisitions` and `candidates`), `hrms.hiring.read`, tenant-scoped; front-end hook | no | n/a | S |
| G2 | Conversion rates and time to hire (P6–P10) | New table `hiring_mgmt.candidate_stage_events` (tenant_id, candidate_id, from_stage, to_stage, changed_at, changed_by) with RLS and grants. Write it (JDBC) on add candidate, stage change, offer created (→Offer), offer accepted (→Hired) and conversion. Add it to G1's response. Older candidates have no history, so rates start from the migration date (or use an estimate from current stages, see Q3) | **yes, new table** | no (new table, JDBC only; `HiringService` is JPA and needs a JDBC writer or an event listener in `hrms-api`) | M |
| G3 | Start a candidate at a chosen stage (A2) | Optional `stage` on `CandidateRequest` (Applied…Offer) and a relaxed `addCandidate`. This is a **business rule change** (Q4) | no | `candidates` is mapped, no column change | S |
| G4 | Candidate email on the offer, and one-click Send (O2, A15) | Store the email: an **unmapped** column `hiring_mgmt.offers.candidate_email` read and written with JDBC (or a side table); fall back to `candidates.email` when `candidateId` is set; add it to the offer response; the create/edit form gets the field | **yes, new column** (or new table) | **yes**, `HiringOffer` maps `hiring_mgmt.offers`. The column must not be mapped | S–M |
| G5 | "Interviews you took this quarter" (I4) | `GET /v1/hiring/interviews/mine/summary` (or add a count to `/mine`) | no | n/a | S |
| G6 | New hires rows with name, department, joining date and template name for any company, plus counts (N2, N4–N7, N1–N3) | Enrich `GET /v1/onboarding/instances`, or add `GET /v1/onboarding/instances/overview` (JDBC join of `hrms.employees`, departments and templates, like `AdminDashboardController.onboarding`). HR only (`instance.write`) | no | n/a | S |
| G7 | Template "Used by N hires" (T3) | Count runs per template (JDBC) in the templates response or a small endpoint | no | n/a | S |
| G8 | Task due "before joining" or "on the joining day" (B12) | Front end: allow 0 and negative offsets. Check due-date sums and the labels; the backend already accepts any integer | no | n/a | S |
| G9 | Asset holder and "returned by" names (S6, S7) | Enrich `GET /v1/onboarding/assets` with holder and last-holder names (JDBC). Needs a privacy decision for managers without `hrms.employee.read` (Q11) | no | n/a | S |
| G10 | Keep an asset for a future joiner ("Ready for <date>") and pick from the store in the wizard (S7, V8, B4) | Either (a) front end only: pick in-store assets in the wizard and assign them on creation (the server refuses future dates, so they are given "today"), or (b) a new table `hrms.asset_reservations` (asset, employee, for_date) with an endpoint, read by the Assets list | (b) **yes, new table** | no (new table) | S (a) / M (b) |
| G11 | Wizard document list from the workspace's document types (V7) | Front end: build the step from `GET /v1/document/types` (required and active). Also, the wizard's "Pending / Rejected" choice is not saved (HR uploads land Verified; the choice is only written into the notes). Fix = let an HR upload set Pending (small `DocumentUploadController` change) or drop the manual status | no | n/a | S |
| G12 | Generated letters: department and template name (L6, L7) | Add both to `GeneratedLetterDto` in `LetterGenerationService.toDto` (the employee and template repositories are already there) | no | n/a | S |
| G13 | Distributions: template name, and recipients by branch (L11, L22) | `templateName` in `DistributionJobDto`; a new `BY_BRANCH` filter in `RecipientFilter` and `LetterDistributionService`, plus in the wizard | no | n/a | S |
| G14 | Scheduled distribution, "Send on" (L23, C11) | Store the date: an unmapped column `letters.distribution_jobs.scheduled_for` or a side table. Add a `@Scheduled` job that starts due jobs and a "Scheduled" status in the list; cancel a scheduled job | **yes, new column or table** | **yes**, `DistributionJob` maps the job table. The column must not be mapped | M |
| G15 | Issue date on Generate letter (L21) | Add `issueDate` to `GenerateLetterRequest`; `MergeFieldResolver` uses it for `today`, `today:long` and `today:iso`; it is kept in `generation_context` (JSON) and shown as "Issued" | no | n/a | S |
| G16 | "My letters" shows HR drafts and voided letters (L17) | Filter `GET /v1/letters/my` to sent letters (and maybe void ones). This is a behaviour change (Q10) | no | n/a | S |
| G17 | Review queue: department, expiry, "verified / rejected this week" (R2, R3, R5, R8) | Add department and `expiry_date` to `GET /v1/document/pending`. Add `GET /v1/document/pending/summary` counting `verification_status` with `verified_at` inside this week (`hrms.document.verify`) | no | n/a | S |
| G18 | Workspace document counts (D1–D4, D16, D17) | `GET /v1/document/summary` (on file, expiring in 30 days, expired, people; `hrms.document.read`) and `GET /v1/document/my/summary` (`read.self`) | no | n/a | S |
| G19 | Letter e-signature, "Signed" (L17; EmpDocs "Review and sign") | A new table `letters.letter_signatures` (letter, employee, signed_at, ip), `POST /v1/letters/generated/{id}/sign` (owner only; either a new permission such as `hrms.letters.sign.self` granted to OWNER, SUPER_ADMIN and EMPLOYEE, or `read.self`), and the status in the DTOs. Shared with the self-service audit | **yes, new table** | no (new table; `GeneratedLetter` stays unchanged) | M |
| G20 | "Confirm you got it" and "Report a problem" on assets (EmpDocs) | New table or unmapped columns on `hrms.onboarding_assets` / `asset_allocations`; `POST /v1/me/assets/{id}/confirm` and `…/problem` (`asset.self`). Shared with the self-service audit | **yes** | `OnboardingAsset` maps `hrms.onboarding_assets`; `asset_allocations` is JDBC only | M |
| G21 | Self-upload on My documents | Front end only (`useSelfUploadDocument` and `useMyMissingDocuments` exist) | no | n/a | S |
| G22 | IT access switches in the wizard (Work email, Slack, GitHub) | Only if wanted (Q6): a new table `hrms.onboarding_access_requests` with an endpoint, and a checklist on the record. **Recommended: do not build.** Keep the roles-and-permissions step | would be yes | no | M |
| G23 | Choosing the company (several companies in one workspace) | Front end: requisition create, letter template create, the onboarding wizard and the New hires department names all use `companies[0]`. Add a company choice (active companies only, `useCompanies`) | no | n/a | S–M |

---

## 11. Conflicts with current behaviour and earlier client decisions

1. **Tab order and names:**
   - Onboarding: design New hires, Checklist templates, Assets; current New hires, Assets, Checklist templates.
   - Employee vault: design Employee documents, My documents; current My documents, Employee documents, Letter templates.
   - The prompt says "keep the tab names and order unchanged" (Q1).
   - The non-HR label "Your onboarding" is not in the design; keep it.
2. **The "Letter templates" view inside Documents.**
   - The design drops it; it duplicates Letters → Templates.
   - If it goes, the Employee Vault menu rule (`recruit:/hrms/documents` accepts `hrms.letters.template.read`) must change. Otherwise a person with only that permission opens an empty page.
   - `live-design-documents.mjs` opens `?view=letters`.
3. **The Hiring pipeline board.**
   - The design shows a table with "Move to <next>".
   - Today's board has drag and drop, Reject and Withdraw, the role filter, a candidate drawer, next-interview and scorecard lines, and "View employee".
   - Keep these (menu or row click) or offer a Board/Table switch (Q2).
   - `live-candidate-conversion.mjs` relies on the board's `<article>` cards.
4. **"Stage" on Add a candidate** goes against the server rule: new candidates start at Applied and no stage may be skipped (`HiringService.assertTransitionAllowed`, checked by `live-w2a.mjs`).
5. **Offers.**
   - The design has one-click "Send offer email" and no status changes.
   - The server needs a recipient.
   - Accept, Decline and Withdraw exist and must stay.
   - "Submitted to …" must stay.
6. **Interviews.**
   - The design merges "Your interviews" and "Upcoming" into one "Coming up" table and leaves out Reschedule, Cancel and Open pipeline.
   - Its schedule form has no **mode** or **place/link**. The server requires the link for video interviews, so keep those fields.
7. **The wizard's Access step.** The design shows IT-system switches; ours is the RBAC roles/permissions picker with a login invite, covered by `live-w3-access.mjs`. Keep ours with the design's styling (Q6).
8. **Wizard button labels.** The design says "Continue" and "Create employee"; ours are "Next" and "Create Employee", and tests match them exactly.
9. **Wizard assets.** The design picks from the store; ours records free text. The server refuses future assignment dates (Q7).
10. **Asset status and labels.** The design shows only "With employee" and "In store", with "Give to" and a Category list. Today we show "Returned", "Assign" and free-text Category, and `live-assets-browser.mjs` matches all three.
11. **Distribution wording.** "Delivered" and "bounced" claim more than we know. The server knows only "sent" (the mail service accepted it) and "failed"; use those words.
12. **Void a letter and Reject a document** are one click in the design. The server requires a reason: Void `@NotBlank`; Reject 3–500 characters, and the reason is shown to the employee.
    - Undo (README) is not possible after Verify or Reject: the employee is notified at once, and there is no un-verify endpoint.
13. **Merge-field syntax.** The design shows `{employee_name}`; the backend uses `{{employee.fullName}}` from `/v1/letters/merge-fields`. Use the catalogue.
14. **My letters and My assets under "My Workspace" for admins.** The Me group stays hidden for OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN (the client rule behind "My Attendance hidden for admins"). Owners still get the "My letters" tab inside Letters (they hold `read.self`).
    - The rail-highlight rule (`railLit.ts`): Me → Letters (`/hrms/letters/my`, `also: ['/hrms/letters']`) must keep lighting Me when opened from Me, and the Letters item otherwise. `live-rail-highlight.mjs` checks this.
15. **Forms as in-page views or side panels.** The prototype swaps the page body for a form, with a Back link. Phase 7 asks for the shared side panel, and today's tests find these forms with `getByRole('dialog')` (Q in §14).
16. **Dates.** Every date field here must stay on `src/shared/components/calendar` (`DateField`). Tests drive `.utc-trigger`, the "Choose date" dialog, the year view, and `#doc-issued` / `#doc-exp` / `#iv-date`.
17. **Settings stay in their sections.** Document types stay at `/settings/documents`, not in the vault. The design agrees; no change.
18. **Companies.** Forms must list only active companies (`useCompanies`, never `useCompaniesWithArchived`). The dashboard's `&company=` on hiring links is ignored by the page today.
19. **"Undo" and optimistic updates** (README) apply to the review queue only as far as the server allows (see 12).

---

## 12. Shared components this area needs

**From the README list:**
- `PageHeader`: back link, crumb, title, sub-line, main and second buttons.
- `PillTabs`: the page tabs in the top bar. Keep `?tab=` / `?view=` / path and accessible names.
- `SearchPill`.
- `StatCard` / stat tile: PgTalent's "stats" block is a small tile with a coloured dot, label, value and note. It is a lighter version of the dashboard StatCard.
- `Card`/`Section`: the frame with title, count chip, sub-line, segmented filter and a small action.
- `ListRow` / table rows: avatar initials in the first column, "name · sub" text, pill cells, and row actions (one main, one secondary).
- `StatusPill`: ok, warn, bad, info and gray tones.
- `SegmentedControl` / `FilterPills`.
- `Meter`/`ProgressBar`: the pipeline-by-stage bars and onboarding progress.
- `Avatar`.
- `EmptyState` (title plus next step), `Skeleton`, error with Retry.
- `Toast`.
- `Popover`/`Menu`: row overflow for Reject/Withdraw, Hold/Resume/Reopen, History, Open profile.
- `Dropdown with search`: employee picker, candidate picker, requisition picker.
- `SidePanel` with a stepper and a sticky footer: the onboarding wizard's 9 steps, and every form here.
- `Dialog`: confirm Convert, Archive template, Cancel interview, Void reason, Reject reason, Delete.
- `FormField`: input, select, textarea, toggle, and date through `DateField`.
- `ApprovalRow` for Docs to review: Verify and Reject with a reason.

**Page-specific pieces:**
- A key-value grid (Conversion; the "Priya Sharma" facts; hire details).
- A vertical step list (wizard).
- A toggle list (Benefits, Policy pack, Joining day).
- A bar list (pipeline by stage).
- The merge-field "Insert field" list.
- The template task editor (order, owner role, required, due).
- The tiptap rich-text letter editor with a preview pane.
- A file drop zone (bulk upload).
- The distribution wizard.
- The asset history timeline.
- The interview block (facts, scorecards).
- The candidate drawer.

---

## 13. Risks

### 13.1 Tests that check today's markup or wording on these pages

- `e2e/recovery/live-offers-browser.mjs`
  - Clicks `[aria-label="Hiring views"]` → Offers, then "Create offer".
  - Fills the form labels Company, Candidate name, Role, "Annual offered CTC (INR)" and Offer terms, then "Save draft".
  - Uses "Edit draft", "Download PDF", "Email offer", "Candidate email" and "Send offer email".
  - Checks "Submitted to" and "Sent", picks WITHDRAWN in the status combobox, and checks "Final decision" and "Withdrawn".
- `e2e/recovery/live-candidate-conversion.mjs`: the pipeline `<article>` card, "Convert to employee", the dialog's "Create employee", and the "View employee" link.
- `e2e/recovery/live-w3-r1.mjs`
  - Offers: "Create offer", the combobox "Joining date", Cancel.
  - Interviews: `?tab=pipeline&role=all`, the button "Open <name>: interviews and scorecards", "Schedule interview", the dialog "Schedule an interview", `input#iv-time[type=time]`.
  - Hire details: `h3` "Hire details", `dt` "Offer accepted", Edit, the dialog "Hire details", "Offer accepted on", Save.
  - The wizard's date-of-birth checks.
- `e2e/recovery/live-design-onboarding.mjs`
  - `[aria-label="Onboarding views"]` with New hires, Assets and Checklist templates.
  - The tiles All onboarding, In progress, Completed and On hold; "Start onboarding"; a row showing "0/3".
  - The heading "<name>’s onboarding", "Put on hold", "Tasks, in order", "HR manager", "With employees", /Register asset/, "Step 1 of".
  - Employee side: no table, "Onboarding started …", "Your onboarding", task `<article>` with "Mark done" → "Task done" / "Done".
  - Manager side: Assets is read-only, and there is no templates view.
- `e2e/recovery/live-onboarding.mjs`: `#field-*` ids, `.utc-trigger`, "Search reporting managers", "Next", "Add Asset", "Create Employee", the success text, "Go to Employee Profile", and the "Onboarding record" heading.
- `e2e/recovery/live-w3-access.mjs`
  - Stepper: an `ol` with `button[aria-current="step"]`.
  - Access step: the heading "Roles and permissions", "Access can be set once this person has a login.", the invite switch text, `[data-access-picker]`, "Next", "Create Employee".
  - Success text: "Login invite sent, and their roles and permissions are saved."
  - No sideways scroll at 390 px.
- `e2e/recovery/live-assets-browser.mjs`
  - `?view=assets`, "Register asset", "Choose a company", the labels Asset tag / Category (typed as text) / Asset name.
  - "In store", "Assign", "Find employee", "Confirm assignment", "With employee".
  - "Take back", "Condition on return", "Record return", "Returned", "History", and the region "Asset allocation history".
- `e2e/recovery/live-design-documents.mjs`
  - `?view=all`, "Add document", "Find employee", Title, "Or a link to an existing document", "Store document".
  - Review queue: `<article>` cards showing "qa.pdf · 20 KB", "View file", "This file can’t be opened here", Reject → "Reject and tell them" (disabled until a reason), /Why it’s rejected/, Verify.
  - `?view=letters` with one h1.
  - Letters: h1 "Letters" and pressed buttons /^Templates/, /^Generated letters/, /^Distributions/; "Still to send".
  - Employee: no "Add document" and no `[aria-label="Document views"]`.
- `e2e/recovery/live-w3-r3.mjs`: the dialog "Add a document", "Find employee", `#doc-issued`, `#doc-exp`, the year view.
- `e2e/recovery/letters-admin-live.mjs`
  - "Generate letter", template buttons in the drawer, "Find employee", "Generate PDF", the letter URL, "Download PDF", "← All letters".
  - A row with `[title=<subject>]`.
  - At 390 px, the drawer heading sits under 40 px from the left and nothing scrolls sideways.
- `e2e/recovery/live-rail-highlight.mjs`: Me → "Letters" (`/hrms/letters/my`) keeps Me lit.
- `e2e/recovery/live-dead-entrypoints.mjs`: `/me` shows "Onboarding tasks".
- `e2e/recovery/live-mobile-layout.mjs`: `/hrms/onboarding/instances` has no overflow on a phone.

**API-only scripts** (behaviour must stay the same; no markup): `live-w2a.mjs`, `live-hr-lifecycle.mjs`, `live-role-matrix.mjs`, `live-summary-notices.mjs`, `live-tenant-isolation.mjs`, `live-w1g.mjs`, `live-learning-dashboard.mjs`, `live-hiring-offers.mjs`, `live-w3-search.mjs` (search URLs `/hrms/documents?view=my`, `/hrms/employees/<id>?tab=documents`).

**Unit tests:**
- `src/shared/navigation/pageRegistry.test.ts` (tab parameters: hiring = `tab`, onboarding and documents = `view`).
- `src/modules/hrms/letters/lettersView.test.ts`.
- `src/layouts/railLit.test.ts`.

**Older Playwright suites** (they may already be stale):
- `e2e/tests/{hr-manager,super-admin}/05-onboarding.spec.ts`: "onboarding templates" text, "New template", "Create template".
- `e2e/tests/*/06-letters.spec.ts`: table rows, "Preview", `iframe[title="Letter preview"]`.
- `e2e/tests/employee/06-my-letters.spec.ts`.
- `e2e/live/pages-sweep.spec.ts` and `today-regression.spec.ts` (open each route).

### 13.2 Other risks

- **Dark mode.**
  - These pages use fixed colours inline: `#0f172a`, `#64748b`, `#94a3b8`, `#f8fafc`, `#e2e8f0`, `#fff`, and `#059669` progress bars and focus rings (Hiring board, Instances, InstanceDetail, Templates, TemplateDetail, AssetsTab, OffersTab, DocumentVault, OnboardingForm, GenerateLetterDrawer).
  - All of them must move to tokens.
- **Font weight.** `HEAD_FONT` with `fontWeight: 800` (board column titles), `font-bold` / weight 700 in the wizard and elsewhere. The limit is 600.
- **Numbers that are wrong at scale today.**
  - Requisitions: only page 0 (20).
  - Candidates: capped at 1,000.
  - Review queue: capped at 200.
  - Instances and assets: no paging.
  - Document tiles: counted from the page on screen.
  - The new summary endpoints (G1, G6, G17, G18) fix this; do not copy the browser counts into the new stat tiles.
- **Only the first company is used.** Requisitions, letter templates, the wizard and New hires department names all take `companies[0]` (G23).
- **The wizard's document status** (Pending or Rejected) is not saved on the document; HR uploads land Verified (G11).
- **Privacy.** "My letters" shows HR's unsent drafts and voided letters to the employee today (G16). Showing asset holder names to managers who cannot read employees (G9) would be a new exposure.
- **The URLs are the contract.** Keep `?tab=`/`?view=`/path, `&role=`, `&stage=`, `?employeeId=`, `/documents/pending` and the old `?tab=candidates`. Bell links, search and the dashboard depend on them.

---

## 14. Open questions

1. **Tab order:** follow the design (Onboarding: New hires, Checklist templates, Assets; Vault: Employee documents, My documents) or keep today's order ("keep names and order unchanged")? And may Documents drop its "Letter templates" view (with the menu rule and the test updated)?
2. **Hiring pipeline:** replace the drag-and-drop board with the design's table (Reject, Withdraw, the candidate drawer and the role filter kept through a row menu and row click), or keep both with a Board/Table switch?
3. **Conversion rates and time to hire:** approve a new stage-history table (exact from now on, "—" for older candidates), or show an estimate from current stages with no schema change?
4. **"Stage" on Add a candidate:** allow starting a candidate at Screening, Interview or Offer (changes the no-skipping rule), or drop the field?
5. **Offer email:** approve storing the candidate's email on the offer (a new unmapped column) so "Send offer email" is one click?
6. **Onboarding Access step:** keep our roles-and-permissions step with the login invite, restyled, and **not** build Work email, Slack or GitHub switches?
7. **Wizard assets:** keep the free-text asset record, pick real assets from the store (given on creation, dated today), or build asset reservations ("Ready for <date>", a new table)?
8. **Letter distributions and signing:** build "Send on" scheduling (a new column and a scheduler) and letter e-signature (a new table) now, or drop "Send on" and leave signing to the self-service Documents work?
9. **My letters:** hide HR's unsent drafts (and voided letters) from employees?
10. **Forms:** use side panels (Phase 7 rule; today's tests look for dialogs) for Add candidate, Open requisition, Schedule interview, Create offer, Register asset, Add document and the rest, rather than the prototype's in-page views with a Back link?
