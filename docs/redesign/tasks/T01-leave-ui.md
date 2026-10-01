# T01 · Leave screens (P-LEAVE, UI half)

**Owner:** chakridol143 (his Claude) · **branch:** `redesign/t01-leave` from `origin/redesign/int` · **PR into:** `redesign/int`
**Backend:** already built and merged (P-LEAVE.be). No migration needed; you get none. If you find a real backend
gap, describe it in the PR and don't build it.

## Read first
`docs/redesign/README.md` → TEAMMATE_SETUP → DECISIONS (items 15, 16, 18, **21**) → REDESIGN_RULES (incl. the SHELL CONTRACT UPDATE) →
PACKAGE_BRIEF → AUDIT.md §1.F, §2.F, §5.8 and the "P-LEAVE" section of §6.3 → AUDIT-ADDENDUM (A, B, G) → CONTRACTS.md →
`audit/leave-payrun.md` (leave parts) and `audit/ess-1.md` §7 (self-service Leave).

## Prototype screens (`docs/redesign/design/prototype/`)
- `PgLeave.dc.html` and `PgTime.dc.html` (page `l-ops`): the HR/approver Leave Operations Center
- `EmpLeave.dc.html`: the self-service leave view (use this, not the old `me-leave`)

## You own ONLY these files
- `apps/platform/src/modules/hrms/Leave.tsx`, `apps/platform/src/modules/hrms/leave/**`
- `apps/platform/src/modules/hrms/api/{useLeave,useLeaveYearEnd}.ts`
- tests: `apps/platform/e2e/recovery/{live-design-leave,live-leave-calendar}.mjs` + new `live-rd-p-leave.mjs`

## Build (same to same as the prototype, from the kit `@/design/kit/{display,overlays,data}` and tokens only)
- **Today's tabs, in today's order**, as **inline pill tabs inside the page** (default `placement="inline"`; NEVER `placement="header"`).
- **The new "All balances" tab** after Decided, key `all-balances`. To make it appear, ask the lead in the PR to add
  `'P-LEAVE'` to `READY_PAGES`; don't edit `pageRegistry.ts`.
- **Approvals:**
  - bulk approve (`POST /v1/leave/approvals/bulk-decision`)
  - Undo via the shared `useRecentDecisions` / `useDecisionUndo` hooks (`modules/hrms/api/shared/`)
  - the HR level (PENDING_L2) through the existing `GET /v1/leave/approvals/pending-l2` and `POST …/{id}/l2-decision`
  - conflict facts on waiting rows
  - approval stats
- **Apply:**
  - the leave preview (`GET /v1/leave/preview`), which shows the exact days, balance after and the refusal reason
  - leave beyond the balance is refused with the real reason (DECISIONS 16)
- **Apply on behalf** (`useApplyLeaveOnBehalf`, permission `hrms.leave.apply.others`) in a side panel.
- **Calendar view** (`GET /v1/leave/calendar`) and **colleagues off** (first names only, approved only).
- **Balance notes:** next credit, reset date, carry-forward cap.
- **Holidays:** list + **edit** (`PUT /v1/settings/holidays/{id}`), titles in sentence case.
- **Bug fix E29:** cancelling a leave must refresh balances and the overview (`useCancelLeave` invalidates them).
- **Pop-ups:** kit SidePanel / Dialog; keep `role="dialog"` + accessible names.
- **Every existing approve/reject hook** also invalidates `SHARED_KEYS.approvalsInbox` and `SHARED_KEYS.recentDecisions`.
- **Dark mode, phones (390 px), fonts:** dark mode works; no sideways page scroll at 390 px; font via `var(--u-font)`.

## Tests (TEAMMATE_SETUP §6)
- tsc, eslint (0 errors), vite build, vitest
- `live-rd-p-leave.mjs`:
  - reader applies, then cancels (balances back exactly)
  - hrm applies on behalf of reader, then cancels
  - mgr bulk-approves 2, then undoes one
  - hrm edits a holiday, then restores it
  - every role sees only what it may; light/dark; 390; no page errors
  - it cleans up everything
- `live-design-leave` and `live-leave-calendar`: selectors only, every behavioural check kept.
- Screenshots of your pages next to the prototype (1440/390, light/dark).

## Hand-in
Open a PR into `redesign/int` with the PACKAGE_BRIEF report, then go on to **T02** while the lead reviews.
