# Company administrator recovery: evidence and handoff

Updated 2026-09-22. This records tested behavior and remaining limits; it is not whole-product release certification.

## Scope and preserved baseline

Work is integrated into apps/platform, using existing APIs, permissions and tenant isolation. Company OWNER/ADMIN is the target, not the SaaS super administrator. Claude's existing changes were backed up before editing to %TEMP%/unifiedtree-codex-baseline-20260922-181144 and were not reset.

Client reference: C:/REACT/unified-tree-hr-dashboard/index.html. Attendance app brand: #0F6E56, #0A5240, #E6F4F1. The live shell has a compact green navigation rail, green header, module tabs and contextual actions. Dashboard content follows the client's workforce, attendance, approvals, activity and milestones requirements. Keka is a layout reference, not a source of invented business data.

## Implemented behavior

| Area | Result |
| --- | --- |
| Shared platform | Responsive branded shell, real header destinations, preserved employee/action search, permission-aware navigation, correct company-owner label, accessible drawers above the fixed header. |
| App chooser | Public catalog schema repaired by V128. Fresh login loads the real catalog; enabled apps remain accessible during a catalog outage. Errors have retry controls and unmatched search has a clear empty state. Owner billing controls match the plan page's role rules. |
| Dashboard | Live workforce and attendance, dated employee drilldowns, approval destinations, hiring, activity, milestones and CSV headcount export. Unavailable data has retry states. Statistical colors are separate from brand colors. |
| Attendance/shifts | Named requester details, requested times, reasons and attachments; paged correction approvals; shift-request decisions; profile Change shift action; IST dates carried into drilldowns. Overlap-safe attendance counts. Same-day shift changes cannot create inverted date ranges. |
| Onboarding | Employee, probation, primary encrypted bank account, salary breakdown, HR details and onboarding instance persist through APIs. Retry resumes after partial completion without duplicating the employee. HR notes accept only allowed fields and exclude payroll amounts/bank identifiers. Saved details are visible in the employee profile. Designation inputs wait for lookup loading; managers are searchable/paged and optional for hires without a reporting manager. |
| Documents | Private multipart upload with type/signature/size checks, tenant keys and compensating cleanup. URL metadata lifecycle verified. Private binary storage still requires external configuration. |
| Advances | Scoped administration, named requests, approval/disbursement, schedule, ledger, deferral, settlement and write-off. Rounding reconciles to principal. Payroll cannot undo a manual settlement on reopen/reprocess. |
| Performance | KPI owner selection, editing, quantitative progress/history and retirement; review cycles, assignment roster, closure and readable feedback. Actual reviewer authorization; manager/employee scope cannot be widened by query filters. Percentage-only goal updates cannot overwrite measured KPIs. |
| Expenses | Named reimbursement batch items/reasons, currency selection, draft build/refresh, posting, atomic cancellation and payment-reference recording. Transactions protect claim membership and duplicate payment attempts. |
| Payroll | Calculate, lock/reopen, PDF payslips, named bank-batch lines, exclusion reasons, rebuild and generic CSV. Payment blocked when employees are excluded. Duplicate active batches and competing payments blocked. Paid runs cannot reopen. |
| Company access | Role changes refresh the open user drawer. Built-in roles show read-only permissions with guidance to clone for customization. |
| Policies | Unpublished/archived previews restricted to policy authors. Employees read/acknowledge active policies; acknowledgement is version-aware and idempotent. |
| Exit/settlement | Notice date and separation reason round-trip through the employee API; reason is omitted from directory lists. Full-and-final detail shows components and confirmation before approval/payment/cancellation. One active settlement per employee exit; exact outstanding advance recovery; transactional debt closure; approval revalidates the employee exit. New advance disbursement is blocked after separation. |
| Letters | Named employee recipients in list/detail/API, paged template/employee selection, explicit load errors, working PDF generation/download. |
| Other modules | Learning pagination/completion, employee-filtered letters, leave/hiring/onboarding lifecycles and reports checked beyond page loads. Existing organization, HR setup, compliance and exit screens remain integrated. |

## Verification record

The API runs canonical,canonical-prod with production JWT/method authorization and PostgreSQL role ut_app: non-owner, non-superuser, no RLS bypass. Live tests use HTTP, the running browser app and real isolated database. The preview test is fixture-driven; error/retry scenarios deliberately inject faults while their normal workflows use live services.

| Check | Evidence |
| --- | --- |
| Frontend | Final TypeScript and Vite production build passed (3,500 modules), including expense, letters, exit and settlement changes. |
| Java | Integrated Maven regression run: 53 tests passed, zero failures/errors/skips, including PostgreSQL concurrency/transactions, seven real-JPA settlement tests, advance-after-exit guards, policy access and ownerless compliance reads. The subsequent narrow directory-name fix was packaged successfully and verified against the real API/browser. |
| Dashboard preview | Desktop/mobile, dated late drilldown, tabs and no horizontal overflow at 390px. |
| Route sweep | 51 original routes reached with zero JavaScript errors and zero HTTP failures. This sweep omitted /modules and did not verify the first screen after login. The reported catalog failure is now covered by live-modules.mjs; /modules has also been added to future sweeps with an enabled HR-tile assertion. |
| App chooser | Real public catalog returned nine rows; fresh login, HR-dashboard navigation and unmatched search passed. A simulated catalog outage showed explicit retry and permitted opening already-enabled HRMS; retry and reload restored the real catalog. |
| App chooser follow-up | V128 applied successfully through Flyway; production build and repeated post-restart browser check passed. Updated API sweep passed all 14 endpoints, including the public catalog. Run `node e2e/recovery/live-modules.mjs` for the dedicated entry-screen regression. |
| Attendance | Correction/request/decision, owner scope, employee denial, named late employee on matching date, persisted profile shift change. |
| Onboarding | Eight-step browser workflow passed after lookup-loading fix: probation, masked bank readback, four salary lines and HR details persisted; profile reload and employee-role denial passed; protected salary field rejected from HR notes. |
| Advance | Approval, disbursement, rounding, deferral, settlement, write-off and object scope. DB tests preserve manually settled advances on payroll process/reopen. |
| Performance | KPI/history/cycle/roster/closure/mobile; manager/employee scope, forged filters, actual reviewer, quantitative consistency and review completion. |
| Payroll/access | Calculate/lock/reopen/reprocess, PDF, CSV, paid readback, denied paid reopen; role grant/revoke and error/retry. Updated browser test passed partial-batch rejection, bank correction, draft rebuild and full-run payment. |
| Cross-tenant | Foreign employee/document/KPI/onboarding, forged tenant header and search results denied/hidden via APIs. Own search results expose only expected directory fields. |
| HR lifecycles | Passed leave approval/cancellation balance, candidate hired/job closed, named policy acknowledgement and onboarding task completion. Draft/archive employee reads and acknowledgements denied; author preview and restore passed. |
| Reimbursements | Five DB tests passed for concurrency, payment/cancellation, old cancellation retries, state drift and currencies. Browser build/named claimant/post/cancel/rebuild/payment/reference/reload/mobile passed with zero feature HTTP/JS errors. |
| Employee import | Actual XLSX download, employee-role denial, invalid CSV rejected, valid row validates/commits once, duplicate rejected. |
| Directory search | Full names, optional middle names, case/extra spaces, first/last/email/code and company/status filters passed on the final runtime. FnF browser picker found and selected the correct employee using a compound full name; zero JavaScript errors. |
| Reports | All six CSV exports matched their JSON report rows/values; employee role denied. |
| Compliance | Optional-owner records read correctly; filing create/file/readback and period-length validation passed. |
| Letters | Live list/detail API returns employee name/code; browser template selection, employee search, local generation, named details, PDF download and mobile drawer passed. No email sent. |
| Exit/settlement | Live notice/cancel/separation/correction/readback and reader-role denial passed. Settlement company/date/duplicate guards, details, cancel/recreate, incomplete-row rejection, approval, different-user payment, mobile and error/retry passed; temporary payment permissions removed. Seven database tests cover concurrency, debt closure without pending installments, exit edits and transaction rollback. |

Run node e2e/recovery/<script>.mjs from apps/platform. Scripts create clearly labelled local test records: use the isolated recovery environment only. Screenshots/JSON: apps/platform/test-results/recovery.

Scripts: company-admin-preview.mjs, live-api.mjs, live-workflows.mjs, live-module-workflows.mjs, live-admin-actions.mjs, live-onboarding.mjs, live-tenant-isolation.mjs, live-advance-admin.mjs, performance-admin-live.mjs, performance-authorization-live.mjs, live-payroll-access.mjs, live-hr-lifecycle.mjs, expense-batches-live.mjs, letters-admin-live.mjs, live-fnf-admin.mjs, live-employee-exit.mjs, live-employee-import.mjs, live-compliance-reports.mjs, live-directory-search.mjs and live-browser.mjs.

## Database and deployment

V122 adds KPI/history contracts, V123 fills eight advanced workflow table contracts, V124 adds eleven permission entries, V125 stores restricted onboarding details, V126 enforces one active payroll bank batch per run, and V127 enforces one noncancelled full-and-final settlement per employee exit. V128 adds the missing module-plan is_included flag with default false, preserving pricing and activation. Migration application is verified on local API startup.

V090's information-only index comment was guarded for clean installs, changing its historical checksum. Existing deployments need deliberate migration/checksum review: do not blindly repair Flyway or deploy from this handoff. V126/V127 intentionally fail on conflicting historical batches/settlements rather than silently rewriting financial records.

## Local environment

- Frontend: http://demo.localhost:3002
- API: http://127.0.0.1:8080/api
- PostgreSQL: 127.0.0.1:55432, database unifiedtree_recovery
- Company owner: owner@unifiedtree.demo / Hrms@12345 (isolated development only)
- Local subscription: 100 seats; HRMS, attendance, leave and payroll enabled. No external purchase.

scripts/recovery-company-owner.sql prepares seed data. scripts/recovery-runtime-grants.sql prepares restricted runtime access. scripts/start-recovery-backend.ps1 starts the API and disables Firebase only locally. Logs: backend.log and backend-stderr.log under %LOCALAPPDATA%/UnifiedTreeRecovery.

The IDE Java builder writes into workspace target folders. Verified Java21 builds therefore use a source copy at %LOCALAPPDATA%/UnifiedTreeRecovery/backend-source excluding target/.git. Run `scripts/test-recovery-backend.ps1` to copy, run the focused recovery regressions against the isolated database and package that source. The launcher copies the JAR into a separate runtime directory so later builds cannot overwrite the running archive. Java runs hidden; ordinary PDF renderer stderr logs cannot terminate the PowerShell launcher.

## Explicit limits

- Separate private R2_DOCUMENT_BUCKET is not configured. Upload validation is tested, but successful binary storage, signed downloads and onboarding photo uploads are not certified against R2.
- Email/invitations, Firebase phone login, face worker and external delivery providers are not certified by local password-login testing.
- Payroll CSV/manual payment references and expense reimbursement recording do not initiate bank transfers.
- Page reachability does not prove every HR policy, payroll formula, browser or permission combination. The workflow evidence above is the acceptance boundary. Deployment/provider checks remain outstanding for production release.
- Nothing has been committed, merged, deployed or published by this recovery work.
