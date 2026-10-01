# Phase 0 merge notes

**The plan is in `/c/REACT/ut-wt/redesign/AUDIT.md`.** It has these sections:

| § | Contents |
|---|---|
| 0 | Summary |
| 1 | Screen map |
| 2 | Missing data and actions per screen |
| 3 | Backend work BW-01 to BW-122, with migration numbers V143_50–65 and the 5 new permissions |
| 4 | Kit, tokens, font and motion |
| 5 | Every delegated decision, with reasons |
| 6 | Build plan: 9 Phase 1 packages, 21 Phase 2 packages, Q1; owned files, dependencies, prototypes and tests; who updates each live test |
| 7 | Risks |
| 8 | Questions: none |

Builders read it after `RULES.md`, `REDESIGN_RULES.md`, `DECISIONS.md` and `PACKAGE_BRIEF.md`, then their own package card in §6.3.

## Inputs merged

- `DECISIONS.md` (items 1–18, binding), `REDESIGN_RULES.md`, `PACKAGE_BRIEF.md`.
- The 15 area audits in this folder: shell, foundation, dashboard, workforce, attendance, leave-payrun, pay, talent, grow-reports, setup-admin, companies-profile, ess-1, ess-2, team, crosscut.
- The design handoff file list (`design-ref/design_handoff_hrms_redesign/prototype/`, 49 files) and `saved-designs.md`.

## Checked against the repo (read-only)

**Frontend**
- `App.tsx` routes, including the `/hrms/att-analytics`, `/hrms/shifts`, `/hrms/pli` and `/hrms/advances` container routes that the seams replace.
- `PlatformShell` `SETTINGS_NAV` and module children.
- `MasterDesign` `NAV`.
- Today's tab lists in `Leave.tsx`, `AttendancePage.tsx`, `Expense.tsx` and `FullAndFinal.tsx`.
- The files under `modules/hrms/**` and `modules/hrms/api/*`, and who imports the shared pieces (`attendanceBuckets`, `shift-util`, `chart.ts`, `AccessPicker`, `useProbation`, `useShiftRequests`).

**Backend**
- Controller locations and the decide endpoints for the five Undo kinds: leave `/decision`, `/l1-decision` and `/l2-decision`; WFH `/approve` and `/reject`; corrections `/decision`; shift change `/decision`; expense `/decision`.
- Where the attendance DTOs are built.
- Overtime is computed at check-out in `AttendanceService` and `CanonicalAttendanceService`, and listed by `OvertimeController`, so the rules apply at the list and decision level only.
- `TenantModuleGuard` has no `/v1/team` or `/v1/ess` entry.
- Spring AOP is available (`TenantFilterAspect`).
- `ConversionOnboardingStarter.start(...)` is public.
- Every existing permission code the plan names exists in the canonical migrations.

**Database** (read-only SQL on `unifiedtree_recovery`)
- System roles: ADMIN, DEPT_MANAGER, EMPLOYEE, FINANCE_LEAD, HR_MANAGER, MANAGER, OWNER, PLATFORM_SUPER_ADMIN, SUPER_ADMIN.
- `hrms.advance.request.others` is granted to ADMIN, FINANCE_LEAD, HR_MANAGER, OWNER and SUPER_ADMIN, so the two new on-behalf permissions mirror exactly that set.
- The latest applied migration is 143.40.

**Worktrees**
- F1: 3 commits, 71 files.
- F2a: 3 commits, plus uncommitted Button, Callout, ColumnChart, Ledger, StepTrack and Table.
- F2b: 2 commits, no dependency or lockfile change.
- `rd-int` is at `e32a4dc6`.

## Where the merge changed an area audit's proposal

1. **Backend folded into page packages.** Each backend file cluster has one owning page package, and packages others depend on merge a `.be` half first. P-HOME's backend runs early (Wave A) because P-ATT-DAY needs BW-122.
2. **Undo recording.** The team audit had the `DecisionJournal` called from the five decide controllers. It is now an `@Around` aspect on the service methods those endpoints call. That way no other package's controller is edited, and bulk and mobile decisions are journaled too. A unit test guards each pointcut.
3. **Side tables, not unmapped columns,** wherever the table is JPA-mapped or shared: POSH department, policy "accept by", program location, offer email, asset confirmations, goal–KPI links, cycle milestones.
4. **Quick-action preferences.** The dashboard audit's table `hrms.user_dashboard_prefs` gains a `surface` key (`dashboard` or `home`) so Home (ess-1 E26) shares it.
5. **Tab names and order.** The attendance audit's C1 renamed tabs to the design's names; the shell audit let page order follow the design. DECISIONS 11 keeps today's names and order, so only real new tabs are added.
6. **Header and quick-action defaults.** `saved-designs.md` ("Header C, icon dock") is outdated. The README and `HrmsPlatform`'s props say Header A + tile row, as the dashboard, shell and foundation audits also concluded.
7. **F2c** is limited to the pieces F2a has not already built.
8. **BW numbering.** The wizard's document status item was dropped: it needs no backend, because the document list comes from document types on the frontend and today's saved behaviour is kept. The ids were renumbered so there are no gaps.
9. **Not built items** are those DECISIONS rules out, those that change pay, balances or counts, those that need outside credentials, and those with no admin design. §5.15 lists each with its reason.

## Not done here

- Nothing in `C:\REACT\unifiedtree-saas` was edited.
- No git state was changed.
- No database was written.
- No push happened.

The only files written are `redesign/AUDIT.md` and this note. Pushing waits on the lead's release gate.
