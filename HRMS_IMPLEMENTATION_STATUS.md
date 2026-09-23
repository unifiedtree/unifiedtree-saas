# HRMS implementation status

Updated: 2026-09-23. This records local implementation and verification, not a production deployment certificate.

Continuation handoff: [HRMS_CLAUDE_HANDOFF.md](HRMS_CLAUDE_HANDOFF.md). Copy-ready instruction: [CLAUDE_CONTINUATION_PROMPT.md](CLAUDE_CONTINUATION_PROMPT.md). File/test inventory: [HRMS_HANDOFF_INVENTORY.md](HRMS_HANDOFF_INVENTORY.md).

## Local runtime

- Frontend: http://demo.localhost:3002
- Spring backend: http://127.0.0.1:8080/api
- PostgreSQL: 127.0.0.1:55432 / unifiedtree_recovery
- Runtime database role: ut_app, without superuser/RLS bypass.
- Canonical Flyway migrations V130-V139 are applied. Source migrations are packaged in the backend jar; no production database was changed.

## Implemented and connected

| Feature | Persistent behavior | Evidence |
|---|---|---|
| Dashboard | Real employee/attendance counts and drilldowns, hiring stages, performance rankings, onboarding tasks, finalized payroll trend, permission-filtered summary and alerts | live-api, live-learning-dashboard, live-summary-notices, browser route sweep |
| Company notices | Create, edit, expiry, archive, pagination | live-summary-notices; live-notices-browser |
| Projects/productivity | Create project/tasks, update status, completion counts, reject closing unfinished projects and modifying closed projects | live-projects, live-new-admin-browser |
| Company/branches | Existing company/branch CRUD reused; branch geofence saved with coordinate/radius validation | live-new-admin-browser |
| Salary overview | Employee salary components and calculated amounts from existing payroll API; paginated directory | live-browser, live-payroll-access |
| Offers | Editable drafts, saved terms, protected PDF, SMTP/Brevo email submission, decision lifecycle, immutable issued content and candidate validation | HiringOfferWorkflowTest, OfferDocumentTest, OfferDeliveryTest, live-offer-documents, live-offer-email, live-offers-browser |
| Assets | Register, assign actual employee, return, persistent allocation history, validation, serialized assignment | AssetWorkflowTest, live-assets-calendar, live-assets-browser (including history) |
| Compliance calendar | Real dated filings/items, month navigation and deadline details | ComplianceReadValidationTest, live-assets-calendar, browser navigation |
| Inspector view | Signed expiring link, calendar/CSV access, selected PDF upload/sharing/download, unshare and revoke | live-inspector, live-inspection-documents, live-inspector-browser |
| Learning/certifications | Employee selection, proficiency, certification issue/expiry dates, edit/upsert, real skill charts | live-learning-dashboard, live-new-admin-browser, live-module-workflows |
| Performance/appraisals | Static tabs replaced by existing KPI/review/cycle workflows | live-module-workflows, performance-authorization-live |
| Document letters | Existing template CRUD/editor in vault; server-filtered paginated employee letters | live-browser, existing letter APIs |
| ESS | Real attendance history and self-owned daily time-entry CRUD; daily 24-hour cap | live-time-workflows, live-time-browser |
| Team schedules | Actual effective shift assignments for the manager's scoped employees, weekly navigation | live-time-workflows, /team browser smoke |
| Overtime | Approve/reject completed attendance records, reviewer/note persistence, no self-approval, re-review changed minutes | live-time-workflows |
| Shift roster | Real employee/current shift data and existing shift-assignment action | browser route sweep, live-workflows from preceding recovery |
| Expense/PLI | Real dashboard aggregates and persisted PLI targets; existing claims/awards retained | live-api, live-hiring-offers foundation reads |
| Bank history | Existing disbursement batch/history/detail APIs reused | live-browser, live-module-workflows |
| Shared feedback | Replaced unmounted/no-op toast context with the application's mounted Sonner notifier | geofence save confirmation verified in browser |
| Role access | Asset inventory no longer exposed via ordinary onboarding-self permission; limited-role tabs/routes corrected | live-summary-notices employee denial, existing tenant isolation and performance scope tests |
| Payroll legacy route | /payroll now redirects to the working payroll dashboard | live-notices-browser |
| Overnight early checkout | Compare absolute shift-end date/time, including next-day end for night shifts | ShiftTimingTest (2 cases); live-night-integration passed |

## Checks completed

- Multiple frontend production builds passed after integration changes.
- Backend packages passed; focused asset, offer, compliance and overnight timing tests passed.
- A 53-route company-owner browser sweep completed with no uncaught page errors or failed API responses. The evidence is apps/platform/test-results/recovery/live-browser.json.
- Focused browser CRUD passed for offers, assets/allocation history, certifications, branch geofence, project/task completion, company notices, overtime approvals, ESS time entries and inspector access/revocation.
- Existing leave, hiring, policy acknowledgement, onboarding task completion, KPI progress/history, training enrollment/completion, appraisal submission, advance recovery and payroll process/lock tests passed.
- Cross-tenant access tests and manager/reviewer performance scope tests passed.

## Important limits still open

- This is not a completed production-readiness audit of every path, every role and every possible state. The route sweep is smoke coverage, not exhaustive acceptance.
- Integrations Directory is a persisted configuration registry, not provider OAuth or synchronization. Removed the fake sync timestamp on manual status changes and made this explicit in the UI. Provider adapters/credentials are not implemented by this directory.
- Offer PDF email submission is implemented through the existing SMTP/Brevo adapters. Local SMTP capture is verified; real provider delivery, signatures, bounce handling and inbox delivery receipts are not verified. Manual 'Mark as sent' remains distinct from recorded email submission.
- Inspector links expose compliance dates/status, CSV export and explicitly shared PDF documents. Each download rechecks session scope, expiry and revocation. Automatic muster export and OTP delivery remain open; signed inspection links are the implemented access mechanism.
- Overtime approval is recorded but not automatically posted into payroll earnings. The required hourly-rate/multiplier or compensatory-leave business rule has been requested from the user; no salary formula is being guessed.
- Team roster shows effective assignments, not a leave/holiday/weekly-off planning engine.
- Asset allocation history now records each assignment/return; V136 backfills the latest known allocation for existing assets. Earlier overwritten allocations cannot be reconstructed.
- Real provider delivery (mail/SMS/banking), remote object storage and production infrastructure have not been verified in this local environment.
- Large-list scalability, every custom role combination, and all mobile layouts need broader acceptance before a zero-gap/production-ready claim. Eight company-role codes passed 64 endpoint grant/deny checks; five key pages passed 390px layout checks. These are focused checks, not exhaustive role/device certification.

No functionality is claimed complete solely because an endpoint returns HTTP 200 or a page compiles.

## Final regression follow-up

- Found a real concurrent-login optimistic-lock conflict when multiple sessions for the same account updated last_login_at. Session-issuing credential reads now take a per-account database write lock; ordinary read methods are unchanged. live-concurrent-login passed three simultaneous sign-ins and authenticated session reads after the final restart.
- Authentication DTO string representations now redact passwords/access/refresh tokens; AuthLogRedactionTest covers this without changing JSON responses.
- Asset history V136 applied; reassignment preserves both employee allocations and return notes. Asset history browser view passed after adapting the test to search the paginated employee directory.
- Integration registry no longer invents last_synced_at on manual status changes; live registry persistence check passed.
- Night-shift early-out live test passed for a checkout before midnight and an on-time checkout the next morning.

## Final local verification

- live-role-matrix: 64 endpoint checks passed across ADMIN, DEPT_MANAGER, EMPLOYEE, FINANCE_LEAD, HR_MANAGER, MANAGER, OWNER and SUPER_ADMIN. Temporary credential/employee fixtures were removed. PLATFORM_SUPER_ADMIN has a separate authentication surface and was not impersonated by this company-role test.
- live-mobile-layout: dashboard, companies, onboarding/assets, shifts and ESS passed at 390px without document-level horizontal overflow or uncaught browser exceptions.
- live-concurrent-login: three parallel sign-ins for one account returned usable sessions, with no optimistic-lock HTTP 409.
- At this earlier regression checkpoint, the backend contained V136, the login locking fix and auth-log redaction. Subsequent sections record V137-V139 and the latest checks.
- The pending user question is the overtime compensation rule. The implementation does not infer an hourly salary formula or silently modify payroll.

## Offer document and inspector export continuation

- V137 adds candidate-facing offer_terms, separate from internal notes. Drafts can be edited through PUT /v1/hiring/offers/{id}; issued/terminal offers cannot be edited.
- GET /v1/hiring/offers/{id}/pdf reuses the existing PDF renderer and saved company/offer details. Read permission is enforced, responses use no-store, internal notes are excluded and all authored text is HTML-escaped. This is a generated offer document, not an electronic signature or a delivery receipt.
- New offers must start as drafts. Create validates company existence; candidate/requisition links must match the selected company and requisition. Offer mutations use a row lock to serialize competing edits/decisions.
- Inspector CSV export includes only the already-visible reporting month's obligation/filing, date, category and status. It makes a fresh capability-authenticated request before every export; a revoked link cannot export from stale browser cache. Spreadsheet formula prefixes are escaped.
- Backend package and seven focused offer/document tests passed. live-offer-documents passed persistence, PDF bytes/headers, issued edit rejection, missing-company rejection and employee read denial.
- live-offers-browser passed creation, draft editing, PDF download, status transitions and reload. live-inspector-browser passed anonymous export and export rejection after revocation. Two CSV unit tests passed.
- External provider names/test-account configuration have been requested. No external email or SMS was sent during these local tests.
- Final frontend TypeScript/production build passed after both additions; local frontend, backend and database remain running.

## Offer delivery and inspection documents

- V138 records offer email recipient and provider-accepted timestamp. POST /v1/hiring/offers/{id}/email sends saved terms plus a PDF through the existing MailService. SMTP and Brevo attachment support preserve existing non-attachment callers.
- Linked offers restrict the recipient to the candidate's recorded address. Closed offers cannot be newly emailed; repeated successful requests to the same recipient return the saved result without another send. Approved terms are required. No automatic retry is performed after uncertain provider failures; the UI asks the operator to check the provider before retrying.
- Local mail is explicitly routed to 127.0.0.1:11025. The durable local inbox at http://127.0.0.1:18025 never relays externally and is started by the recovery launcher. It is a development tool, not a production mail server.
- V139 adds session-scoped inspection PDF metadata. Administrators explicitly share/unshare PDFs up to 5 MB. The public download endpoint checks the signed token, active session and document/session association, streams bytes and returns no-store. No durable public storage URL is exposed.
- Recovery uses private local disk at the configured inspection.local-path. Production without that explicit local setting uses the existing private DocumentStorage/R2 adapter. Remote R2 transfers were not exercised locally. Unsharing removes access metadata; private objects remain and need a retention/cleanup policy.
- Backend package and eight focused offer tests passed; final frontend production build passed. live-offer-email verified actual local SMTP/PDF capture, one message for concurrent repeated requests and persisted submission metadata. The offer browser test verified email submission and subsequent workflow/reload.
- live-inspection-documents verified upload, exact byte download, invalid file rejection, cross-session denial, unsharing and revocation against the real database/filesystem.
- Automatic approval review rejected the proposed temporary stop of the local mail catcher for an outage test with 'blocked by policy'. The service was not stopped; the live provider-outage/transaction-rollback test remains unverified.
- Overtime compensation policy and the requested external integration providers/test-account configuration are still unanswered. The complete HRMS is not certified gap-free or production-ready.

- Final inspector browser rerun passed PDF upload/download, CSV export and denial after revocation; the original filename assertion was corrected to include the displayed file-size label.

## Continuation — 2026-09-23 evening (shift effective dates, Resignation & Exit)

Working ledger: [HRMS_MODULE_ACTION_LEDGER.md](HRMS_MODULE_ACTION_LEDGER.md) (route → permission → API → state → evidence, plus new findings).

Baseline re-verified before changes: main @ e5d1982 with the dirty tree preserved; 3002/8080/55432/11025/18025 owned by the expected processes; 3002 proxies to the local Spring API (no Cloudflare headers); Flyway canonical history tops at V139; owner login OK.

| Change | Files | Evidence |
|---|---|---|
| **Shift changes take effect on a chosen date** (client complaint #2). The "Change shift" drawer never sent `effectiveFrom`, so every change started today; and `EmployeeShiftService.getCurrentShift` returned the OPEN assignment, so a scheduled change was reported as current immediately while the date-aware team schedule still showed the old shift. | backend `EmployeeShiftAssignmentRepository` (`findEffectiveOn`, next-after query), `ShiftDtos.EmployeeShiftResponse` (+`effectiveTo`, `upcoming*`), `EmployeeShiftService.getCurrentShift`; frontend `attendance/EmployeeShiftAction.tsx` (effective-date field, current/scheduled summary, dated toast, min-date guard), `attendance/ShiftRoster.tsx` (shows "→ shift from date"), `api/useShiftPolicies.ts` | `EmployeeShiftServiceTest` 4/4 + `ShiftTimingTest` 2/2; `e2e/recovery/live-shift-effective.mjs` 12/12 against the restarted local backend: future-dated assign 200, today's shift unchanged, `effectiveTo` = day before, upcoming reported, `/v1/team/schedule` shows the old shift today and the new one on the date, reload, date before current start → 422 `SHIFT_DATE_INVALID`, employee login → 403, schedule restored |
| **Resignation & Exit page** — the sidebar leaf pointed at `/hrms/fnf` (same as Full & Final; the shell dedupes by path), so HR had no list of who is serving notice. | new `modules/hrms/exit/ExitCenter.tsx` at `/hrms/exit` (`hrms.employee.read/write`, module `hrms`), `App.tsx` route, `PlatformShell.tsx` leaf. Reuses `GET /v1/hrms/employees?status=`, `/employees/counts`, `POST …/notice`, `…/cancel-notice`, `…/exit`, `PUT` dates. Tabs On notice / Exited / Terminated; Start notice picker (any status shown, employees already leaving disabled — new hires are PROBATION); Edit dates; Withdraw notice; Mark exited; F&F link. | `e2e/recovery/live-exit-center.mjs` 12/12 (browser): both leaves reach their own routes; start notice → row → reload → API NOTICE_PERIOD with dates → withdraw via confirm → ACTIVE; employee login 403; 0 page errors / failed calls on the page |
| Frontend `tsc` + `vite build` passed; backend `mvn -pl app/hrms-app -am -DskipTests package` passed; recovery backend restarted from that jar via the launcher (only the owned PID stopped). | | |

New finding (not fixed): every browser sign-in triggers two `POST /v1/canonical-auth/refresh → 422` after two 401s on the first post-login requests; pages work afterwards. Recorded in the ledger (auth) for the login-flow audit.

Still open from the handoff (unchanged): overtime pay rule, external provider configuration, inspector OTP decision, offer-delivery outage test, remote R2, full role/mobile/scale acceptance.
