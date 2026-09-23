# Claude continuation prompt

Copy everything below into Claude while it has access to C:\REACT\unifiedtree-saas.

---

You are taking over active implementation of UnifiedTree HRMS. Continue the existing work carefully; do not restart the architecture or create a separate frontend.

First read these files in this order, in full:
1. C:\REACT\unifiedtree-saas\HRMS_CLAUDE_HANDOFF.md
2. C:\REACT\unifiedtree-saas\HRMS_IMPLEMENTATION_STATUS.md
3. C:\REACT\unifiedtree-saas\HRMS_FUNCTIONALITY_AUDIT.md
4. C:\REACT\unifiedtree-saas\HRMS_IMPLEMENTATION_PLAN.md
5. C:\REACT\unifiedtree-saas\UNIFIEDTREE_AGENTS.md
6. C:\REACT\unifiedtree-saas\UNIFIEDTREE_CODEX_MASTER_CONTEXT.md
7. C:\REACT\unifiedtree-saas\HRMS_HANDOFF_INVENTORY.md

The audit/plan include historical sections. The new handoff explains current implementation, verification scope and remaining gaps. Confirm source/runtime evidence instead of treating old claims as current truth.

My objective is the COMPLETE working HRMS in this repository: existing UI, every relevant module/action, APIs, database persistence, roles/settings, usable error states and end-to-end workflows. Company admin is the primary priority, distinct from our SaaS platform super admin. The original backend requirements are a minimum, not the full scope. Do not reduce this to a small repair sprint.

Preserve the existing UnifiedTree-branded UI and working features. Keka was a layout/design reference, not a request for its colors or content. Do not remove unfinished visible functionality to claim completion. Replace static operational data with actual backend behavior and honest empty states.

The original client problems must be demonstrably solved:
- "One person is late" must identify the employee and useful details.
- Employee shift changes must be accessible and persist with correct effective behavior.
- Issues/requests must show who raised them, their details and real actions.
- Every meaningful card/button/filter/table/export must have a real permitted workflow.

I have already authorized local implementation and local demo data. Do not ask me again whether to start routine authorized work. Ask only for actual missing business decisions or external configuration and keep independent work moving. Broad permission is not permission to guess salary formulas, bypass tenant isolation or send real external messages indiscriminately.

Important current state:
- The working tree is intentionally dirty and includes essential UNTRACKED files. Do not reset, clean, overwrite or recreate it. Preserve work by previous agents and any unrelated concurrent edits.
- Local frontend: http://demo.localhost:3002
- Local API: http://127.0.0.1:8080/api
- Local PostgreSQL: 127.0.0.1:55432 / unifiedtree_recovery, runtime role ut_app with RLS enforced.
- Local SMTP inbox: http://127.0.0.1:18025, SMTP port 11025. Messages are captured locally, not sent externally.
- V130–V139 have been applied locally. Never edit applied migrations; inspect current history before adding the next one.
- Vite DEFAULTS TO THE DEPLOYED API unless VITE_PROXY_TARGET is explicitly set. Follow the handoff's local startup commands.
- A backend build does not update the running jar. The handoff explains the launcher, JarPath, process ownership and readiness.
- Keep PlatformShell.tsx as the real shell/navigation source and preserve existing module/RBAC/RLS gates.

Already implemented locally: real dashboard widgets/notices/projects, company/geofence and salary views, offers with editable drafts/PDF/email submission, asset allocation/history, compliance calendar, signed inspector access/CSV and explicitly shared PDFs, certifications/performance integration, letter templates, ESS entries, team schedules, overtime review, shared toast fixes, role navigation fixes and concurrent-login repair. Read the handoff for exact paths and nuanced limits; do not rebuild these blindly.

Do not claim the entire system is complete:
- Production provider delivery and remote R2 remain unverified.
- Integration directory is only a persisted configuration registry.
- Inspector OTP and automatic scoped muster export are still missing.
- Overtime approval exists, but payroll compensation rules are unanswered.
- Offer provider acceptance is not inbox delivery; synchronous mail/DB failure ambiguity needs hardening.
- Broad role/device/scale acceptance remains incomplete.
- An SMTP outage test was blocked by automatic approval review. Respect that boundary, use an allowed isolated test harness, and do not claim it passed.

Work sequence:
1. Establish the actual baseline: Git/untracked inventory, local proxy and ports, login, migration state, relevant latest tests.
2. Maintain a module/action ledger with route -> permission -> API -> persistent state -> positive/negative/reload evidence.
3. Audit all reachable modules and fix real gaps, including original client complaints and FNF/imports/exits/issues/reports/settings beyond smoke checks.
4. Harden offer delivery and finish inspector workflows using existing services.
5. Ask for the exact overtime policy and required provider names/configuration if still unanswered; continue unrelated work.
6. Implement approved overtime/provider behavior with idempotency, scope and error handling.
7. Complete company-role/custom-role, tenant, responsive, accessibility and realistic-data acceptance.
8. Prepare migration/deployment evidence and a truthful final completion report.

For each meaningful change:
- Identify the existing behavior and exact gap.
- Reuse current controllers/services/hooks before adding new ones.
- Implement UI, validation, authorization and persistence together.
- Verify actual writes and reloads, invalid states, denied access and errors—not only compilation or HTTP 200.
- Run appropriate tests and inspect failures. Some test scripts depend on local fixtures and leave QA records; follow handoff ordering and never target production.
- Update HRMS_IMPLEMENTATION_STATUS.md, HRMS_FUNCTIONALITY_AUDIT.md and HRMS_IMPLEMENTATION_PLAN.md with precise evidence and remaining gaps.

Do not casually rewrite stable payroll/leave/auth/onboarding logic, invent missing business rules, disable security, fabricate provider success, auto-retry ambiguous email sends or declare "zero bugs." Do not repeat earlier setup questions answered in the handoff.

After reading, briefly tell me what you verified, the real unresolved decisions and the first concrete work sequence, then proceed with the authorized implementation. Continue toward the complete agreed scope; keep blockers and incomplete work visible rather than calling a partial result fully finished.

