# HRMS redesign — the user's decisions (27 Sep 2026, before sleeping). Binding for every agent.

Source of truth for the design: `C:\REACT\ut-wt\design-ref\design_handoff_hrms_redesign\`
(README.md, CLAUDE_CODE_PROMPT.md, prototype/*.dc.html). Read README.md and CLAUDE_CODE_PROMPT.md fully.
The user's words: "redesign of the whole hrms module do the side bar and more options header everything and all
of the pages same to same ... some common designs also use them where ever needed ... dont create anything static
everything should be end to end called with the apis from backend nothing should be dummy or static ... dont mess
up anything ... not create new problems ... do this very carefully by thoroughly checking and doing the testing".

1. **Process:** Phase 0 audit first, then build ALL phases (foundations, shell, admin pages, self-service, team,
   companies, profiles, pop-ups everywhere, QA) without waiting for review.
2. **Where it goes:** merge to `main` and push ONLY when everything is built and every test is green.
   Pushing `main` auto-deploys the web app (Vercel) and, when `backend/**` changes, the backend (Cloud Run).
   Production applies DB migrations BY HAND later, so: no JPA-mapped column changes (ddl-auto=validate would stop
   production booting); new tables/columns are read/written with JdbcTemplate only; every new feature degrades
   gracefully (hidden/empty/error state for that block only) until its migration is applied; every new permission
   is granted to OWNER (and SUPER_ADMIN) in its migration (OwnerPermissionInvariantCheck).
3. **Missing features:** "Build everything" — design pieces whose feature the backend lacks (e.g. Take a break,
   Customise quick actions, approval Undo, Around you events) are built END TO END: service, endpoint, permission,
   tenant scoping, migration if needed (new tables allowed; JDBC only), tests, and the frontend hook. Nothing fake.
4. **Dark mode:** build it too — dark tokens from `hrms-core.js` → `DARK`, the Light/Dark switch in the More panel,
   and every page must work in both themes.
5. **Font:** Plus Jakarta Sans (400/500/600 only) for the WHOLE app.
6. **Menu & homes:** the user said "see which is safest and better for this platform, proceed with that" — the lead
   decides after the audit (default: follow the design's grouping and permission-driven homes; every page keeps its
   current URL; settings stay where they are now, which the design agrees with).
7. **"Viewing as"** role switcher: never shipped (prototype-only). Roles are never hardcoded: permissions drive everything.
8. Standing rules from earlier sessions: never edit the user's editor checkout `C:\REACT\unifiedtree-saas` except when
   the lead merges; no production data; no GCP; don't process/lock/pay a real payroll run; test fixtures cleaned up;
   brand colour is #0F6E56 (design token "Brand"); plain-language UI copy.

9. **Timing and push (user, 27 Sep, later):** "take your time and push whenever needed to the main after thorough
   testing, green signal is better time to push, like everything should be done". → No redesign branch is pushed to
   GitHub (local worktree branches only). Push `main` ONCE, when every page is redesigned and every test is green.
   Quality over speed.
10. **Build approach (lead):** the shared kit is hand-built React (typed components in `apps/platform/src/design/kit/`),
    styled exactly from the design's inline styles (`Ut*.dc.html`, `StyleGuide.dc.html`, README), using the design's
    CSS variables `var(--u-*, <light default>)`. Page packages may reuse the repo's `.dc.html` → TSX converter where the
    audit shows it helps, but every data value comes from real hooks.

11. **Menu grouping (lead, from audit/shell.md §4):** the design's rail groups (Home · People · Time · Pay & benefits ·
    Org & policy · Insights · Business apps · My team · My work) are a PRESENTATION LAYER over today's nav items.
    - Every nav item keeps its internal key, path and `MENU_RULES` key. URLs, route guards and who sees what do not change.
    - My work (Time, Leave, Pay, Documents, Growth) replaces the single "Employee Self Service" item. Each new key gets an
      explicit `MENU_RULES` entry that copies today's ESS rule for that page, including the admin-role exclusion
      (My Attendance stays hidden for OWNER/ADMIN/SUPER_ADMIN/COMPANY_ADMIN). Each key is added to `railLit.SELF_SERVICE_RAIL`.
      A missing rule silently falls back to a wider one, so every new key needs its own entry.
    - Page order inside a module and where a rail click lands stay AS TODAY. Tab names and order stay as today
      (the handoff prompt says so). Payroll configuration stays a Workforce (Master) page.
    - Permission-driven, nothing removed: people keep every admin module their permissions open today. For example,
      managers keep Attendance & time, Leave, Shifts, Muster roll and Expenses approvals next to My team and My work.
      When a person sees both an admin module and a My work item with the same short label, the My work item reads
      "My time" / "My leave" / "My pay" / "My documents" / "My growth". The rule comes from the visible set, never from a
      role name. My work items' accessible names/tooltips are always "My …".
    - Business apps: plan admins only (25 Sep rule). My team: today's `/team` rule.
    - Settings: the header gear and the profile menu go (as in the design). Settings open from More → Settings →
      Preferences, which opens the first settings page the person can open. More lights on settings pages
      (`railLit`). Every settings page keeps its URL and its own section (Master rules & policies, Payroll settings,
      Expense policies, HR setup, /settings/*, /users, /roles, /audit-logs). Mention the new entry point in the final report.
    - More → My space: "My workspace" (the person's Home), "My profile", plus **"All apps"** (`/modules`). The launcher
      is still the post-login landing and must stay reachable now that the header button goes.
    - Help & support (More → Settings) opens a small panel listing the workspace's owners/admins with work emails,
      from a new endpoint. "Admins" means people who hold the permission to manage users and roles, not a role name.
      No vendor name or link anywhere (white-label rule). The rail has no "UnifiedTree HRMS" sub-line.
12. **Homes (lead, from audit/shell.md §5):** Home is chosen by PERMISSION. `useRoles().isEmployee` is a role-name
    check and goes; there is no new permission and no migration.
    - `adminHome` = anyOf `hrms.employee.read`, `payroll.runs.read`, `org.company.write`, `hrms.report.headcount`,
      `hrms.report.attrition`, `hrms.report.attendance`, `hrms.report.leave`, `hrms.report.diversity`. It gets the admin
      dashboard at `/dashboard` (rail "Dashboard"). The same rule is used for `MENU_RULES['/dashboard']` and the registry entry.
    - Everyone else gets the self-service Home at `/me` (rail "Home"). For them `/dashboard` redirects to `/me`, so the
      launcher tile and old links keep working. The old staff dashboard (`RoleDashboard`) is no longer routed.
      Someone with neither lands on the first page they can open, else `/no-access`.
    - Team blocks on Home and the My team group show for anyOf `attendance.team.read`, `hrms.leave.approve.l1`, and
      not `hrms.employee.read` (today's `/team` rule).
    - No loss for managers (they move from the admin dashboard to Home):
      - Their Home / Team today carries the team's day split.
      - "Around you" includes company notices (`/v1/admin/dashboard/notices`) and milestones.
      - Past-date team history stays available through Attendance & time → Daily tracking, which they keep.
    - Greetings use `greetingName()`.
13. **Not built in this redesign:** notification events the backend never sends, which appear only as sample rows in
    the design (payslip ready, payroll ready for review, probation ends soon, self-review due, member not checked in,
    onboarding finished). They would start sending NEW messages to real people in production. The popover shows the
    real notifications. List these in the final report as optional follow-ups.
14. **Foundation (lead, from audit/foundation.md §8–§15):**
    - Default theme is **Light for everyone**, as today. The More-panel switch changes it, stored per device in
      `localStorage['ut.theme']` (the existing key). The `index.html` no-flash script must resolve exactly like the
      provider, so it no longer follows the OS setting. No DB column.
    - Pre-auth pages (sign-in, forgot/reset password, accept invite, pending approval) stay light. Non-HRMS routes must
      at least use tokens.
    - Dark values the design doesn't give (success, info, leave, holiday, amber, stat accents, toast, focus ring): use the
      audit's §2.2 proposals, which were checked for contrast.
    - Contrast: the README requires 4.5:1 for text, so `--u-ink3` = `#60706A` and leave text = `#A94E17`. The difference
      from the sample values can't be seen. Components keep the design's `var(--u-ink3,#6A7A73)` fallback form.
    - Brand fills stay `#0F6E56` in dark. Brand TEXT always uses `var(--u-brt)`, never a raw `#0F6E56` (2.89:1 in dark).
      The dark toast must stay visible: the design's toast colour disappears on the dark page.
    - 3D art slots: dropped (README: no other imagery, and no art files exist).
    - Canvas: a flat `var(--u-bg)` (the emerald radial "ground" gradient on `body` goes).
    - Font: load only Plus Jakarta Sans 400/500/600 (`display=swap`). Drop Inter, JetBrains Mono (mono = system
      `ui-monospace`) and the unused Tabler stylesheet. Replace every inline Inter stack IN THE SAME CHANGE.
      Add `font-synthesis-weight: none`. Tailwind bold/extrabold/black resolve to 600.
    - Keep the markup that existing tests and fixes rely on:
      - `role="tab"`/tablist where today's tab bars use it, and ModuleKit Views' `role=group` + `aria-pressed`
      - HrDrawer close label "Close panel", error retry "Try again"
      - `role="switch"` toggles, `role="alert"` errors, `role="dialog"` + accessible name on every dialog and panel
      - the `.ut-card` class on cards, and the `.ut-card.fixed/…` and `.ut-input.pl-*` overrides
    - `backdrop-filter` never goes on a panel or `.ut-card` (it breaks fixed descendants; 14 drawers broke on 23 Aug).
      The blurred backdrop is a SIBLING element of the panel.
    - One Toast: success bottom centre for 2.6s (design); errors stay up 7–8s (today's behaviour).
      `useDesignToast`/`useSettingsToast`/`useReportToast` delegate to it.
    - The shared calendar (`src/shared/components/calendar`) is re-tokened for dark, never replaced.
    - `color-mix(in oklab, …)` tints get a plain fallback for older phone browsers.
    - Motion: `data-rise` only on top-level cards, never on table rows. `prefers-reduced-motion` switches it all off.
15. **Team, approvals, Undo (lead, from audit/team.md §6, §7, §11):**
    - **Undo:** build it end to end as ONE shared mechanism (team.md §6.3):
      - a decision journal table (JDBC only), recorded on every decision path (web, mobile, inbox)
      - one undo endpoint per kind (leave, WFH, attendance fix, shift change, expense), using the decide permission
      - the window is **10 minutes**, and Undo is refused once anything downstream has used the decision (payroll
        lock/paid, reimbursement batch, the new shift started, a WFH punch)
      - the employee is notified that the decision was taken back
      - when the table is missing, decisions work as today and no Undo is shown
    - **Probation on Team today:** managers SEE their team's probation dates. A new permission
      `hrms.probation.team.decide` is granted ONLY to OWNER + SUPER_ADMIN by default; admins can grant it to managers in
      Roles & permissions. Confirm/Extend buttons show only with it (team-scoped). The stored auto-extend setting stays
      inactive, as today; switching it on would change probation dates on its own. So Home/Team never says "extends by a
      month on its own". Report the inactive setting as found-not-fixed.
    - **My team:** today's rule. People with `hrms.employee.read` don't get My team.
    - **Inbox:** the design's kinds only (Leave · Attendance · Requests (WFH + shift change) · Expenses). Overtime,
      advances and skill approvals stay on their own pages. Rows the caller can see but not decide come back as
      `canDecide=false`; `ApproverScopeGuard` is NOT widened.
    - **Send a reminder:** anyone with `attendance.team.read`, for people in their team scope. It goes through the existing
      notification pipeline (in-app + push per the employee's preferences), at most once per person, day and reason.
      No new permission.
    - **WFH count:** show "N days this month" only. No new allowance setting ("of 6" is not shown).
16. **Self-service (lead, from audit/ess-1.md §10, §14). Rule used: build what the design shows, but never change existing
    hours, pay, balances or who-can-do-what unless an admin switches it on.**
    - **Web check-in/out (E1):**
      - Build it behind a per-company switch "Allow web check-in", **OFF by default**. It is a JDBC-only column on
        `settings.hr_configuration`, with the toggle in HR Configuration → Attendance rules.
      - Browser location is required (the geofence rule is unchanged; approved WFH days are exempt). No face check on web.
      - A `WEB` method is added, with the check-constraint migration. The API refuses `WEB` while the switch is off or
        the migration is missing.
      - While the switch is off, "Your day" is read-only with no Check in/out button. Punching stays mobile-only, as decided on 6 Jun.
    - **"Check in again" (E2):** "Undo check-out" for your own check-out, within 10 minutes. Shown only where web check-in is on.
    - **Breaks (E3):** build start/end (event log). Breaks only pause the "Your day" timer; counted `work_hours` and pay do NOT change.
    - **WFH allowance:** DECISIONS 15. Show the count only, no new setting.
    - **Timesheet (E19):** build projects on time entries and a weekly "Submit week" to the manager, all additive:
      - The project is optional; a description alone still works, as today.
      - Only weeks the person submitted get locked, which never happened before.
      - New `hrms.timesheet.approve` granted to OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER (team-scoped).
      - Submitted weeks appear as a row type in the Approvals inbox. Lower priority: after the core pages.
    - **Optional holidays (E17) and branch holidays in counts (E18): NOT built.** Both change attendance, leave and
      payroll numbers for existing companies. Holidays show as today (name, date, type/branch labels, no Book button).
      Report both as needing the client's decision.
    - **Leave beyond the balance:** refused, as today. The apply form shows the real refusal reason, not the design's
      "extra days unpaid".
    - **Temporary shift change "Until" (E20):** build it (additive; a null end date means permanent, as today).
    - **"Explain the late mark" (E25):** option A. It opens the existing fix request prefilled for the check-in time (frontend only).
    - **"Message team" (E22):** build team announcements. New permission `hrms.team.message` granted to OWNER,
      SUPER_ADMIN, DEPT_MANAGER, MANAGER. Recipients are only the sender's team (`TeamEmployeeScope`). They appear in the team's Around you.
    - **Payroll line on "Fix this day":** show the real "Payroll is processed on {date}". Drop "Fixes after that count next month".
    - **Colleagues off (E14):** first names of same-department colleagues with APPROVED leave only. No leave type, no pending requests.
    - **Leave page:** keeps today's first tab. Balance notes show only rules that exist and work today: next credit,
      reset date, carry-forward cap. Nothing from unused columns.
    - **Also build:** the read APIs E4, E5, E8–E13, E15, E16, E21, E23, E24; the notices `event_date` (E12); probation for
      managers per DECISIONS 15.
    - **Fix the two bugs found:** E28 (approving a fix must keep a WFH day as WFH) and E29 (cancelling leave refreshes balances).
17. **Companies and profiles (lead, from audit/companies-profile.md §5):**
    - **My profile:** option A. The new tabbed layout stays at `/profile` and keeps every current section. Approval
      delegation and Notification choices go into a **Preferences** tab that keeps the `#st-…` anchors, including the
      "keep in view while sections above load" behaviour.
    - **Self-edit:** as today. People edit only what they can edit today (display name, contact phone, photo). First/last
      name, city and emergency contact stay HR-owned. The design's edit affordances appear only on self-editable fields.
      "Mobile" stays the login's recovery phone.
    - **Per-branch check-in switch:** keeps today's meaning. Only the copy changes, to say exactly what it does.
    - **On-behalf actions on another person's profile** ("Apply leave on behalf", "New claim on behalf"):
      - Build them end to end with new permissions whose grants mirror the existing "advance on behalf" permission
        (OWNER + SUPER_ADMIN always).
      - The request goes through the employee's normal approval chain, and the employee is notified.
      - Lower priority: after the core pages.
    - **Geofence radius:** today's range (25–5,000 m) and validation. A slider plus a number field; existing branches
      above 500 m stay valid.
    - **Branch code left blank:** stays blank, and the review shows "None". No server-generated codes.
    - **An admin's own profile:** tabs by permission, except Attendance, which stays hidden for admin roles (client decision).
18. **Cross-cutting (lead, from audit/crosscut.md §16):**
    - The legacy employee form's navigation guard (N11) stays a native `window.confirm`. It is synchronous inside a
      capture-phase handler and works; an async dialog would change the flow.
    - Approval Undo is server-side (DECISIONS 15).
    - Pop-up titles move to sentence case ("Confirm probation", "Add holiday"), the design's copy style. Tests that
      assert the old titles are updated, and their behaviour assertions stay.
    - Dead pop-ups (crosscut §4.9) are left untouched. Nothing is removed without the user's approval; list them in the report.
    - No new test dependencies (no jsdom or Testing Library: that would mean a network install and a lockfile change).
      Kit logic is covered with vitest on pure functions, and behaviour with live Playwright scripts.
    - **FEATURE_NOT_READY convention:**
      - Adopted for every JDBC-only feature whose migration may not be applied yet. The service catches
        `BadSqlGrammarException` (SQL states 42P01/42703) and throws
        `HrmsException("This isn’t switched on yet.", SERVICE_UNAVAILABLE, "FEATURE_NOT_READY")`.
      - The web app shows that block's "not available yet" or empty state and hides its actions. `isRetryable` does
        NOT retry FEATURE_NOT_READY.
      - The helper is built ONCE, in the backend-conventions step, before any backend package starts.
    - **Migration numbers:** the redesign uses `V143_50` upward. The lead assigns exact numbers per package. Nobody
      picks their own, and `V143_41`–`V143_49` are left for the teammate's work on main.
19. **Push from this PC (user, 27 Sep 09:05):** "take your time and complete everything and push into the git so its
    deployed". The redesign is pushed to `main` from this PC once everything is complete and green (DECISIONS 9).
20. **Release 1 (user, 27 Sep ~10:40: "i want the new look to show mainly the dashboard header side bar working well"):**
    - Ship FIRST, as soon as it's green: the new theme and font, the restyled legacy page kits (every page gets the new
      look), the shell (side bar, header, More, Home by permission) and the redesigned admin dashboard.
    - FRONTEND ONLY: the release branch = `main` + the redesign's `apps/` and `packages/` changes, with `backend/`
      exactly as on `main`. No migrations and no idle APIs. Blocks that need a new endpoint stay hidden (the hooks
      return notAvailable).
    - Nothing in the menu, search or routes may point at a page that isn't built yet (F3a gates these with one list).
    - The gate before pushing Release 1: tsc, lint, build, vitest; the 55-script baseline comparison with the
      Release 1 frontend on the main-jar backend; F3a's and P-DASH's live tests; screenshots of the shell and the
      dashboard in light/dark at 1440/390.
    - The backend halves already merged into `rd/int` (team, shifts, payroll core, attendance) ship later, together
      with their page UIs, in the next releases.

21. **Client answers (user, 1 Oct 2026). Binding; these override earlier items where they differ.**
    - **Font:** back to the font the app used BEFORE Release 1: **Inter**, which the module pages, the module kit and the
      shell used. The design's Plus Jakarta Sans is dropped. Weights stay 400/500/600.
    - **Navigation:** the new left rail stays exactly as it is. The **Pages panel on the left goes**.
      - A module's pages now show as **tabs along the top, in the header** (today's Pages-panel content).
      - A page's own sub-sections (its views, e.g. Leave → Approvals / Balances) sit **inside the page, under those top
        tabs**, as inline pill tabs.
      - It must be clear and appealing, with no confusion between the two levels.
      - This REPLACES the old shell contract where the page's own views went into the header (see REDESIGN_RULES).
    - **Dashboard:** same content, about 10% tighter (spacing, padding, card sizes). Today it feels too spacious.
    - **Greeting:** the FULL name, everywhere (web; the app later).
    - **Dark mode:** kept.
    - **Web punch-in with face scan:**
      - ON by default for every company, with a company setting to turn it off. This replaces DECISIONS 16's
        "off by default, no face on web".
      - Face scan per the NextWave reference (`nextwave-refernce.mp4`; frames in `redesign/ref/nextwave/`).
      - The video also covers face enrollment on web.
    - **Manager punch for a team member:** it exists, but people didn't find it. Show it prominently right after login
      on the manager's Home (and wherever the team is shown).
    - **Face punches calendar-wise:** a month calendar per employee in Daily tracking, with the day's punches when a day is opened.
    - **"Upcoming milestones" is renamed "Upcoming events"** everywhere. It covers holidays, company events/notices,
      birthdays, work anniversaries and retirements.
    - **Org chart (the "manager view, Keka reference"):**
      - a Keka-style hierarchy tree from the top person down, by reporting line and position
      - for EVERY role: an employee sees everyone above them and anyone below them
      - lives in the Org page as its own sub-tab
    - **Overtime:** a minimum time of **1 hour by default**, changeable by people/roles with the permission
      (top-order roles, e.g. `attendance.policy.manage`).
    - **Shift planning / schedule** (rotations, wizard, swaps): **ON HOLD** until the client clarifies.
    - **Production DB changes:** the teammate (has DB access) applies them, following the lead's exact instructions per release.
    - **Teammate:** uses his own Claude account, GitHub user `chakridol143` (write access), Windows. Work is split via
      GitHub: branches + pull requests into `redesign/int`, and tasks as Issues/files; the lead reviews, merges and pushes `main`.
    - **Vercel branch previews:** left on (the user's choice).
