# UnifiedTree HRMS — complete engineering handoff to Claude

Prepared 2026-09-23 from the working repository and implementation session. This is a continuation brief, not a declaration that the entire HRMS is production-ready. Paths are relative to C:\REACT\unifiedtree-saas unless absolute.

## 1. Mission and user intent

Continue the complete HRMS in the EXISTING platform UI and backend. The user abandoned a separate prototype/frontend. Company admin is the primary user, distinct from the SaaS platform super administrator. Scope includes every reachable module, settings, role access, frontend actions, APIs, validation, persistence and usability—not only the endpoints in the original list.

Preserve the integrated design. References were Keka's layout, navigation, cards, tables and graphs, with UnifiedTree colors/content. Original reference locations supplied by the user:
- C:\REACT\unified-tree-hr-dashboard
- C:\REACT\attendance

Verify those external directories if needed; this handoff does not certify their contents.

Original client failures remain explicit acceptance cases:
- A late-attendance count must identify WHO is late and open useful employee details.
- An administrator must find/change an employee's shift, with effective dates reflected in schedules/attendance.
- An issue/request must identify its requester, details, status and actionable workflow.
- Every visible action must perform a real permitted operation and show loading/empty/error/success states.
- Existing modules must not disappear or regress as new functionality is added.

The user authorized local implementation and demo/test data and dislikes repeated requests to proceed. This does not supply missing payroll policy or production integration credentials. Ask for actual missing business inputs while continuing independent work. Do not promise zero bugs or invent completion.

## 2. Read order and truth hierarchy

Read:
1. HRMS_CLAUDE_HANDOFF.md — this consolidated brief.
2. HRMS_IMPLEMENTATION_STATUS.md — feature state, verification history, remaining limits.
3. HRMS_FUNCTIONALITY_AUDIT.md — current module/route inventory, then historical findings.
4. HRMS_IMPLEMENTATION_PLAN.md — current continuation plan, then historical plan.
5. UNIFIEDTREE_AGENTS.md and UNIFIEDTREE_CODEX_MASTER_CONTEXT.md — repository architecture rules.
6. HRMS_HANDOFF_INVENTORY.md — Git, migration, changed-file and test snapshots.
7. Relevant live source and tests before changes.

The current source/runtime evidence takes precedence over stale historical statements. Update conflicting notes rather than blindly trusting them.

UNIFIEDTREE_AGENTS.md refers to docs/platform/CODEX_MASTER_CONTEXT.md; that path was absent. The root UNIFIEDTREE_CODEX_MASTER_CONTEXT.md exists and was used. A physical backend_requirements.md was not found in the preceding audit; the user pasted the requirements, preserved in section 8.

This tree includes earlier Claude/Antigravity/user work. Not every dirty file or existing test was authored by this continuation. The inventory captures state, not exclusive authorship.

## 3. Repository baseline and preservation

At handoff inspection:
- Branch: main.
- HEAD: 97bb40a4a96783d7c4cda7939bbf56c915551181.
- Large mixed working tree: modified tracked files plus essential untracked sources, migrations and tests.
- No single committed handoff checkpoint was created. A clean clone of HEAD will NOT contain all this work.
- .design-sync/NOTES.md, .design-sync/config.json and .claude/ were present in the current inventory; preserve them. They were not part of the latest feature implementation.
- No production deployment or production database migration was performed in this continuation.

Do not reset, clean, overwrite or recreate the repository from an earlier checkout. Inspect status and relevant diffs first. Git diff omits untracked files: preserve those when transferring work. Do not blindly stage every file or commit runtime data/secrets.

Live architecture:
main.tsx -> App.tsx -> PlatformShell.tsx -> routed page -> hooks/client -> controller/service -> database.

Preserve PlatformShell.tsx as the navigation source. Do not revive old Sidebar/Header/DashboardLayout, TopModuleNav or dead navigation files. Do not introduce duplicate dashboards or broaden permission gates to make tests pass.

Preserve JWT permissions, tenant RLS, company scope and employee/team object-level authorization. Avoid casual rewrites of PayrollEngine, LopCalculator, stable leave/onboarding/notifications and RBAC/RLS services.

Windows file edits: use UTF-8 explicitly. Default Python cp1252 reads previously caused mojibake and were repaired. Verify command working directories; do not prefix backend/ when already working inside backend.

## 4. Exact local runtime

| Component | Address/location | Notes |
|---|---|---|
| Frontend | http://demo.localhost:3002 | Vite live source |
| API | http://127.0.0.1:8080/api | Controller paths omit /api |
| PostgreSQL | 127.0.0.1:55432 / unifiedtree_recovery | Local recovery database |
| Runtime DB role | ut_app | Non-superuser, no RLS bypass |
| Local SMTP | 127.0.0.1:11025 | Captures mail, never relays externally |
| Local inbox | http://127.0.0.1:18025 | Captured MIME messages |
| Runtime root | %LOCALAPPDATA%\UnifiedTreeRecovery | Outside repo |
| API logs | backend.log, backend-stderr.log under runtime root | Read narrow relevant sections |
| PostgreSQL data | runtime root\postgres | Preserve existing cluster |
| Captured mail | runtime root\mail | Persistent local test messages |
| Inspector PDFs | runtime root\inspection-documents | Explicit private disk setting |

All five ports were listening when the handoff was prepared. PIDs may change; never assume a historical PID.

Demo identities:
- Tenant aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.
- Company cccccccc-cccc-cccc-cccc-cccccccccccc.
- Owner login owner@unifiedtree.demo; local test password Hrms@12345, overridable with RECOVERY_PASSWORD in tests.
- Owner employee 11111111-1111-1111-1111-111111111111.
- Owner workforce email admin@unifiedtree.demo, display name Admin User. This differs from the login email; use the workforce email when searching the employee picker.
- Employee-scope login reader@unifiedtree.demo, same local password; employee 22222222-2222-2222-2222-222222222222.
- Recovery DB credentials are in scripts/start-recovery-backend.ps1. These settings are local-only; never apply them to production.

### Startup and build

Inspect ports/ownership and reuse healthy processes before starting anything. Other Vite/Turbo processes may exist; do not terminate unrelated applications.

Frontend, from repository root, if 3002 is not already serving this app:

~~~powershell
$env:VITE_PROXY_TARGET = 'http://127.0.0.1:8080'
$env:VITE_API_URL = '/api'
$env:VITE_API_BASE_URL = '/api'
pnpm --filter platform dev --host 0.0.0.0 --port 3002 --strictPort
~~~

CRITICAL: apps/platform/vite.config.ts defaults to https://api.unifiedtree.com and port 3001. Explicitly set the local proxy/port. Otherwise local UI testing can silently use the deployed API.

Frontend build/typecheck, repo root:

~~~powershell
pnpm --filter platform build
~~~

Backend build, working directory C:\REACT\unifiedtree-saas\backend:

~~~powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
mvn -pl app/hrms-app -am -DskipTests package -q
~~~

Focused backend tests, same directory:

~~~powershell
mvn -pl app/hrms-app -am '-Dtest=AuthLogRedactionTest,ShiftTimingTest,AssetWorkflowTest,ComplianceReadValidationTest,HiringOfferWorkflowTest,OfferDocumentTest,OfferDeliveryTest' '-Dsurefire.failIfNoSpecifiedTests=false' package -q
~~~

These passed in focused subsets across the continuation—not a claimed final combined full-suite run. scripts/test-recovery-backend.ps1 runs an older broader suite in a copied source tree; inspect before using. Its robocopy /E does not delete stale destination files. Latest builds used the working repo directly.

Backend launcher from repo root, after checking that the previous recovery backend is not occupying 8080:

~~~powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\REACT\unifiedtree-saas\scripts\start-recovery-backend.ps1','-JarPath','C:\REACT\unifiedtree-saas\backend\app\hrms-app\target\hrms-app-1.0.0-SNAPSHOT.jar'
~~~

Pass JarPath: the launcher default points to an older copied-source build. It copies the jar into runtime, uses canonical/canonical-prod profiles, local DB, classpath canonical/dev-seed migrations, local SMTP and inspection disk storage. A Maven build alone does NOT update the running backend. Startup takes roughly 1–2 minutes; wait for readiness and check logs.

Before any backend restart, identify the listener PID and verify its command line contains UnifiedTreeRecovery. Act only on that owned process, within the active execution policy. Never kill all Java/Node/Postgres processes.

If PostgreSQL is down, inspect scripts/restart-recovery-postgres.ps1 first. It uses the existing recovery cluster, PostgreSQL 18 pg_ctl.exe, port 55432 and stale-PID checks. Do not initialize a replacement DB or delete its directory.

SQL CLI:
C:\Program Files\PostgreSQL\18\bin\psql.exe
Arguments: -h 127.0.0.1 -p 55432 -U postgres -d unifiedtree_recovery
The isolated recovery setup permits this local admin connection without supplying a password. Do not change production auth to match it.

Flyway history: public.flyway_schema_history_canonical, not the default table name.
V130–V139 were applied successfully. scripts/recovery-runtime-grants.sql was applied through V139 for the local ut_app role. It is NOT a production security migration.

## 5. Implemented work and source map

Source roots in this section:
- Frontend: apps/platform/src/modules/hrms/
- API: backend/app/hrms-api/src/main/java/com/hrms/api/
- Domains: backend/modules/
- Migrations: backend/app/hrms-app/src/main/resources/db/canonical/

### Dashboard, company and payroll overview

Frontend: CompanyAdminDashboard.tsx; dashboard/CompanySummary.tsx, CompanyNotices.tsx, OperationalWidgets.tsx, ProjectProductivity.tsx.
API: workforce/AdminDashboardController.java, DashboardSummaryController.java, CompanyNoticeController.java, ProjectController.java.

Implemented:
- Permission-filtered real summary/alerts, performers, hiring stages, onboarding counts and finalized payroll trends.
- Replaced identified invented project/productivity/prediction data and unsupported comparison captions.
- Notices create/edit/expiry/archive/paging.
- Projects/tasks create/status/actual completion. Cannot close unfinished projects or change closed projects. This is not a complete project-management product.
- Active employee dashboard destination now filters Employees.tsx correctly.
- organization/Companies.tsx reuses real CompaniesTab/BranchesTab in OrgSetup.tsx. Geofence values save with coordinate/radius validation in WorkforceDtos.
- payroll/SalaryOverview.tsx and SalaryStructureAdmin.tsx show real employee salary structures with paginated directory.
- /payroll redirects to the working payroll dashboard in App.tsx; Payroll.tsx no longer presents a coming-soon stub.

### Hiring offers, PDFs and mail

Frontend: hiring/OffersTab.tsx, api/useHiring.ts, integrated through Hiring.tsx.
API: hiring/HiringController.java, OfferDocumentController.java, OfferDeliveryController.java, OfferDeliveryService.java.
Domain: hrms-hiring HiringService, offer entity/repository/DTOs.

Implemented:
- Create/edit drafts, sent/accepted/declined/withdrawn lifecycle. Terminal decisions cannot reopen.
- Creation cannot bypass lifecycle by starting accepted. Company/candidate/requisition relationships are checked; offer mutations lock the row.
- Candidate-facing offerTerms persist separately from internal notes.
- GET /v1/hiring/offers/{id}/pdf reuses PdfRenderer, escapes authored text, excludes internal notes, enforces read access and returns no-store.
- POST /v1/hiring/offers/{id}/email submits saved terms plus PDF through existing MailService.
- EmailMessage attachment support and SMTP/Brevo implementations preserve existing non-attachment callers.
- Requires approved terms; linked candidates must use their recorded email address.
- Successful submissions persist emailRecipient/emailSubmittedAt. Repeated successful same-recipient requests do not resend. Manually marking SENT does not fabricate email metadata.
- Tests captured one actual local SMTP/PDF message from concurrent repeated requests.

Limits:
- Mail acceptance is not inbox delivery, electronic signature or bounce confirmation.
- Sending is synchronous inside a DB transaction. Accepted mail followed by response/DB failure remains ambiguous; do not claim exactly-once delivery.
- No automatic retry after uncertain failures; UI tells operator to check provider.
- Production Brevo/SMTP was not exercised. Recovery sends only to the local catcher.
- Review idempotency/outbox/attempt history and failure paths before production readiness.

### Assets and onboarding

Frontend: onboarding/AssetsTab.tsx, AssetHistory.tsx, api/useAssets.ts; Instances.tsx integration.
Backend: existing OnboardingController/OnboardingService; OnboardingAssetRepository locking.

Register, employee search, assign, return and persistent allocation history work. Invalid dates, duplicate assignments, wrong employee company and mismatched onboarding instances are rejected.
GET /v1/onboarding/assets/{id}/history retains multiple assignments/returns.
V136 backfills only the latest known allocation; older overwritten history cannot be reconstructed.

Important permission decision: ordinary onboarding instance.read must NOT expose company asset inventory. Asset read or admin instance-write checks are intentional.

### Compliance, inspector access and files

Frontend: compliance/FilingCalendar.tsx, InspectorSessions.tsx, InspectionFiles.tsx, InspectorView.tsx, inspectorCsv.ts; Compliance.tsx and public /inspection route.
Backend: ComplianceService/repositories; compliance/InspectorAccessService.java, InspectorAccessController.java, InspectionDocuments.java, InspectionDocumentController.java.

Implemented:
- Real date-range calendar queries, not the first truncated page; valid date spans.
- Signed expiring HMAC capability links, separate from app JWTs. Token in URL fragment.
- Public POST verifies token before tenant context binding, then checks active session/company.
- CSV export requests fresh authorized data; formula prefixes are escaped.
- Admin explicitly shares selected PDFs up to 5 MB with one session.
- Files list/download only after scope/expiry/revocation checks. Cross-session download denied.
- Unshare/revoke stops access. Downloads stream bytes with no-store, not long-lived public storage URLs.
- DocumentStorage.read/R2Storage.read added for private streaming.
- Explicit local inspection.local-path in recovery; otherwise existing private R2 storage is used.

Limits:
- Remote R2 transfers not tested here.
- Unshare removes access metadata but retains private objects. Retention/cleanup and stronger audit-history policy remain review items.
- File validation is size/PDF signature, not comprehensive malware/content scanning.
- /inspector-sessions/otp is a session-creation alias, NOT an implemented delivered/verified OTP mechanism.
- Scoped automatic muster export remains open.

### Attendance, shifts, ESS and overtime

Frontend: attendance/ShiftRoster.tsx, OvertimeApprovals.tsx, ShiftsAndOt.tsx; ess/TimeEntries.tsx, AttendanceHistory.tsx, EssDashboard.tsx; team/TeamSchedule.tsx, TeamDashboard.tsx.
API: attendance/TeamEmployeeScope.java, TeamScheduleController.java, OvertimeController.java; workforce/TimeEntryController.java.

Implemented:
- Shared team scope preserves admin/department/direct-report behavior.
- Weekly schedule uses effective shift assignments for scoped employees.
- Self time-entry CRUD uses JWT identity, future-date checks, 24-hour daily cap and serialized mutations. It does not silently alter attendance/payroll.
- Overtime approvals/rejections record minutes, reviewer and note. No self/out-of-scope review. Changed source minutes need review again.
- Actual employee/current-shift roster with existing assignment action.
- AttendanceService and ShiftTiming.java compare absolute next-day end for overnight early checkout.

Limits:
- Overtime approvals do not post payroll earnings or comp-off.
- Roster is not a complete leave/holiday/week-off planning engine.
- Night tests covered before-midnight early checkout and next-morning completion—not every late/check-in/break/timezone case.

### Learning, performance, letters and reused modules

- Learning certifications use actual employee/skill data, proficiency and issue/expiry dates. Domain SkillService/DTO/entity changes and V131; skill-only routing corrected.
- Performance static tabs reuse AdminReviews/AdminCycles/AdminKpis. Manager scope, reviewer ownership, progress/history and review submissions tested.
- Document vault template tab reuses letters/LetterTemplates.tsx.
- employees/workspace/EmployeeLetters.tsx uses real server employee filtering and paging.
- Employee-document R2 storage is separate from inspector's explicit local option. Do not infer all vault uploads now work without R2.
- Expense statistics and PLI targets use real APIs; existing claims/awards preserved.
- Bank history reuses existing batch/history/detail APIs.
- Existing leave, hiring candidates, policy acknowledgements, onboarding tasks, training completion, advance recovery and payroll workflows were exercised. These are reused capabilities, not all new implementations.
- FNF, imports/exits, reports, helpdesk/issues and all other routes still need systematic current acceptance beyond smoke testing.

### Shared feedback, roles, integration truth and authentication

- apps/platform/src/shared/hooks/useToast.tsx now uses the mounted Sonner notifier. Previous unmounted context silently dropped feedback.
- App.tsx, PlatformShell.tsx and tab defaults admit relevant offer/skill/asset/inspector/template permissions while preserving module gates.
- Integrations.tsx and IntegrationService show a truthful configuration registry. Removed fabricated last_synced_at on manual toggles. The registry does not implement provider OAuth/synchronization.
- Canonical UserCredentialsRepository/AuthService session-issuing reads lock per account to fix concurrent-login optimistic-lock failures. Ordinary reads were not globally locked.
- AuthDtos string representations redact passwords/access/refresh tokens without changing JSON.
- Three concurrent sign-ins passed. Full refresh replay/lockout edge cases are not comprehensively certified.

## 6. Applied migration ledger

All files are in backend/app/hrms-app/src/main/resources/db/canonical/.

| Version | File |
|---|---|
| V130 | V130__hrms_static_ui_backend_foundations.sql |
| V131 | V131__learning_certification_expiry.sql |
| V132 | V132__hr_projects.sql |
| V133 | V133__employee_time_entries.sql |
| V134 | V134__overtime_decisions.sql |
| V135 | V135__company_notices.sql |
| V136 | V136__asset_allocation_history.sql |
| V137 | V137__hiring_offer_document_terms.sql |
| V138 | V138__offer_email_submission.sql |
| V139 | V139__inspection_documents.sql |

Applied locally. Do not rewrite applied migrations or repair checksums to conceal drift. Confirm the highest version again before adding migrations. Many files are untracked and must be preserved.

## 7. Verification and test execution

Recovery scripts: apps/platform/e2e/recovery/.
Run browser scripts from apps/platform so Playwright and fixture paths resolve:

~~~powershell
node e2e/recovery/live-offer-documents.mjs
node e2e/recovery/live-offer-email.mjs
node e2e/recovery/live-offers-browser.mjs
node e2e/recovery/live-inspection-documents.mjs
node e2e/recovery/live-inspector-browser.mjs
~~~

Run live-inspection-documents BEFORE live-inspector-browser: it generates test-results/recovery/inspection-fixture.pdf using a PDF from an existing offer. Seeded offer data must exist.

Tests perform real local writes. Some retain visible QA records, others clean up fixtures. Never run against production or a real user tenant.

Latest verification:
- Final frontend TypeScript/Vite build and backend package passed.
- HiringOfferWorkflowTest: 6 passed; OfferDocumentTest: 1; OfferDeliveryTest: 1.
- Inspector CSV Vitest: 2 tests passed in preceding continuation.
- Local SMTP/PDF capture, duplicate successful request suppression, persisted mail recipient/timestamp and note exclusion passed.
- Offer browser create/edit/PDF/email/status/reload passed.
- Inspector API real upload/download bytes, invalid file rejection, cross-session denial, unshare and revoke passed.
- Inspector browser upload, anonymous PDF/CSV download and revocation passed after correcting a title assertion to include the displayed file-size label.

CSV test command from root:

~~~powershell
pnpm --filter platform exec vitest run src/modules/hrms/compliance/inspectorCsv.test.ts
~~~

Earlier verified, not all rerun after every later change:
- live-browser.mjs: 53 owner routes with no uncaught page errors/failed API responses at that sweep. Evidence apps/platform/test-results/recovery/live-browser.json.
- live-role-matrix.mjs: 64 allow/deny checks over ADMIN, DEPT_MANAGER, EMPLOYEE, FINANCE_LEAD, HR_MANAGER, MANAGER, OWNER, SUPER_ADMIN.
- PLATFORM_SUPER_ADMIN has separate auth and was NOT impersonated by the company-role test.
- live-mobile-layout.mjs: five key pages at 390x844, not all routes/devices.
- live-concurrent-login.mjs: three concurrent usable sessions.
- Assets/history, certification/geofence/project writes, notices, ESS/overtime, night shift and registry checks.
- live-module-workflows, live-hr-lifecycle, live-tenant-isolation, performance-authorization-live, live-payroll-access: targeted domain/scope/payroll checks described in the status file.
- Additional scripts in the inventory are not automatically proof of execution or final-state success.

Important unverified test:
Automatic approval review rejected the command intended to temporarily stop the local SMTP catcher for an outage test, reporting only "blocked by policy". No part of that rejected command executed. The catcher was not stopped, and live-offer-email-failure.mjs was not created by it. Do not claim live mail-outage/DB-rollback verification passed. Use an allowed isolated failure-injection harness; do not evade policy by rephrasing the rejected command.

No production deployment, actual provider inbox delivery, remote R2 acceptance, full load testing or complete every-role/every-state certification was performed.

## 8. Original pasted requirements

The original list is a minimum contract, not a complete scope boundary:

| UI/area | Requested behavior/API |
|---|---|
| CompanyAdminDashboard | /v1/admin/dashboard/stats, notices, alerts |
| ShiftsAndOt | /v1/attendance/overtime and approve/reject |
| ESS Daily Track | /v1/ess/timesheets, daily time-entry persistence |
| TeamDashboard | /v1/team/schedule |
| Expense | /v1/expense/dashboard-stats |
| PLI | /v1/pli/targets |
| BankDisbursement | /v1/payroll/disbursement/history or verified existing equivalent |
| Compliance | inspector-sessions, OTP, calendar-events |
| Hiring | /v1/hiring/offers and offer workflows |
| Onboarding | assets, assign and allocation tracking |
| DocumentVault | letters/templates, requested /v1/documents/letters-templates or existing equivalent |
| Performance | KPI and appraisal workflows |
| Learning | Certifications and skills |
| FullAndFinal | Verify existing APIs and close advanced workflow gaps |

Reuse actual equivalent APIs and document the mapping; do not invent duplicate endpoints solely to mirror draft requirements. The user also explicitly asked for thorough repository-wide review and completion of ALL modules.

## 9. Unanswered business inputs

Already asked, not answered:
1. Overtime policy: paid overtime with which eligible components/hourly divisor/multiplier, compensatory leave, or approval-only? Also establish eligibility, caps, rounding, effective date, approval cutoff and reversal behavior before changing pay.
2. Required external providers (email/SMS, banking, accounting, etc.) and available test-account configuration. Ask for names/configuration locations, not pasted secrets.

These block dependent business-rule/production work, not independent local fixes. Broad permission to work is not a payroll formula.

## 10. Next implementation plan

### A. Verify baseline without redoing completed work

Read the handoff and inventory. Inspect dirty/untracked files, local proxy, ports, login, DB grants and migration history. Run relevant latest flows. Preserve the working state and investigate discrepancies. Avoid a fresh architecture or a separate UI.

### B. Complete the remaining module/action audit

Maintain a screen-action ledger: UI route, action, permission, endpoint, persistent tables, success/reload evidence and rejected/error cases. Prioritize real failures over cosmetic changes.

Recheck the client's original examples: late-person details, effective shift changes, requester identity/details. Review helpdesk/issues, FNF, imports/exits, reports/exports, payroll/bank, settings and every other route beyond mere smoke coverage. Add missing real operations where the ledger finds gaps. Do not remove visible features or replace them with fake success.

### C. Harden offer email delivery

Use an allowed isolated harness for provider rejection/timeouts, transaction rollback, accepted-mail/failed-DB ambiguity, repeat requests and retries. Consider a durable attempt/outbox ledger and provider idempotency where appropriate; do not automatically retry ambiguous sends.

Check SMTP compatibility for existing notifications. Verify Brevo against an authorized sandbox when configured. Maintain internal-note exclusion and candidate recipient restrictions. Delivery callbacks, bounces and signatures are not already complete.

### D. Finish inspector workflow

If OTP is still required, implement actual challenge delivery/verification with hashed short-lived codes, attempt/rate limits, recipient binding, expiry, replay handling and audit events. Preserve working signed-link access until any replacement is verified.

Implement explicitly scoped muster exports using existing reporting services, with selected company/date range/fields and appropriate approval/access. A valid inspection link must not automatically expose unrelated employee/payroll data.

Add document-sharing audit/retention/cleanup policy and real private R2 acceptance. Verify expiry, tenant isolation, cross-session access, revocation/unshare races and role controls. Signed links are not OTP and uploaded documents are not government-portal filings.

### E. Implement overtime/roster from approved rules

Once compensation rules are supplied, implement effective-dated policy and idempotent reviewed-overtime payroll posting or comp-off accrual. Respect locked/paid payroll. Prevent duplicate payment across reruns, and support approved corrections/reversals.

Test approval -> payroll calculation -> lock -> disbursement/reversal as relevant. Expand roster visibility for leave/holidays/weekly offs if required. Cover night shifts, timezone boundaries and overlapping assignments. Do not casually rewrite PayrollEngine/LopCalculator.

### F. Implement the selected external integrations

The directory is a registry, not functioning provider sync. For required providers add real configuration, secure backend-held credentials, connection tests, actual sync jobs, idempotency, truthful health/last-success timestamps, error/retry reporting and disconnect behavior.

Separate local recovery from production configuration. Verify external mail/SMS/bank/storage using authorized test accounts. Do not fabricate a successful provider connection when credentials or implementations are absent.

### G. Finish roles, usability and scale acceptance

Test eight company roles and representative custom permissions across actual workflows, not only a small endpoint matrix. Check same-tenant employee/team boundaries and cross-tenant denial. Test platform super admin through the correct separate auth surface only where in product scope.

Verify role changes/token refresh, module gates, navigation, desktop/mobile widths, keyboard/focus, empty/loading/error states, list pagination, exports, bulk actions and realistic data sizes. A build and 53-route owner sweep do not prove all roles and all states.

### H. Prepare release evidence and rollout

After relevant changes pass, run a fresh broader acceptance pass. Verify migrations on a separate clean test database, production-like runtime grants/RLS, backups, rollback/recovery and operational dependencies.

Report exact completed functionality, tests/failures, unanswered inputs and deployment limits. Do not call the entire assignment done from HTTP 200, screenshots or compilation. Deployment must follow actual user authorization and environment policy.

## 11. Completion rules and continuation style

- Keep working across the agreed scope; do not convert this into a tiny repair sprint and stop after a few unrelated wins.
- Do not ask again for routine local implementation permission already granted. Ask precise questions for actual missing business inputs.
- Preserve current features, branding, navigation and working flows.
- Every implemented feature must have reachable UI, correct backend authorization/validation, persistent state and appropriate success/failure/reload evidence.
- Keep claims narrower than the evidence. Do not report mocks, manual status changes, provider acceptance or generated files as more than they are.
- Keep status/audit/plan current; record blocked/unverified tests honestly.
- If an action is blocked, report the actual reason and use allowed alternatives without evasion.
- No expectation of zero regressions can be guaranteed. Verify, preserve and communicate carefully.

First continuation response after reading: state the verified baseline, genuinely missing decisions and next concrete implementation sequence, then begin authorized work. Do not send the user through already answered setup questions.

## 12. Handoff boundaries

This handoff task only creates/updates documentation. It does not deploy or silently change application functionality. Existing live local services and demo data are retained.

Known remaining limits to carry forward:
- No production-delivery, remote-storage or all-role certification.
- Offer synchronous mail/DB ambiguity and live outage test still unresolved.
- No real inspector OTP or automatic scoped muster export.
- Overtime policy not supplied; no automatic overtime pay posting.
- Integration registry is not provider synchronization.
- Inspector private-object retention/cleanup and stronger audit history need review.
- Team roster is effective assignment display, not complete leave/holiday planning.
- Old overwritten asset histories cannot be reconstructed.
- Historical tests/fixtures are not all fresh final-state proofs.

