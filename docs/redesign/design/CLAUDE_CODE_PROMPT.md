# Prompt to paste into Claude Code

Copy everything below the line into Claude Code, run from the root of `unifiedtree/unifiedtree-saas`, with the `design_handoff_hrms_redesign/` folder placed at the repo root.

---

You are implementing a full UI redesign of the HRMS module in this repo (frontend: `apps/platform/src`). The design is in `design_handoff_hrms_redesign/`. Read `design_handoff_hrms_redesign/README.md` completely before writing any code. Treat `design_handoff_hrms_redesign/prototype/*.dc.html` as the **visual source of truth**. The files are HTML with inline styles, so read exact colours, sizes, spacing, radii and copy from them. The prototype is a reference, not code to copy. Rebuild it in our React app with our existing patterns.

## Non-negotiable rules

1. **Do not break anything.**
   - Keep every existing route, redirect, permission check, React Query hook, query key, mutation, validation rule, analytics event and test.
   - This is a UI change on top of working features. Do not remove or rename a feature, route or API call unless I approve it.
   - When a page is restyled, its behaviour must stay identical or get better.
   - After each phase run the typecheck, lint, unit tests and the app build. Fix every failure before moving on.
2. **Everything is real and end-to-end. No static or dummy data.**
   - Never port `prototype/hrms-data.js`, `emp-data.js`, `hrms-dash.js` or any hardcoded arrays, names, numbers, dates or amounts.
   - Every figure, list, chart, calendar, status, balance, payslip, approval, notification and count comes from the backend through the existing hooks in `modules/hrms/api/*`, `@unifiedtree/sdk` and `core/*`. Create a new hook only if none exists, following the same pattern.
   - Every action (approve, reject, check in/out, apply leave, WFH, shift change, regularise, claim, advance, sign letter, accept policy, confirm asset, upload document, add company/branch, set geofence, update profile and so on) must call the real API. It must invalidate or refresh the right queries and show real success or error feedback. Never show a fake toast.
   - **The backend is in this same repo.** If a design element needs data or an action the API doesn't provide yet, implement it end to end: service, endpoint, permission check, tenant scoping, migration if needed, tests, and the frontend hook. Follow the existing backend conventions. **Show me the plan and ask before any database schema change.** Never fill a gap with mock data.
   - Every data block has a loading skeleton, an empty state and an error state with Retry.
3. **Roles are dynamic. Do not hardcode three roles.**
   - The prototype shows three example personas (HR admin, Manager, Employee) only to illustrate. In production, derive everything from the signed-in user's permissions and active modules, as `layouts/PlatformShell.tsx` already does with `visibleWithAnyPermission`, `usePermissions`, `useAnyPermission`, `usePermission` and `PermissionGate`.
   - Any role must work automatically, with no code change: OWNER, SUPER_ADMIN, COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, EMPLOYEE, and any custom role created in RBAC. A user can combine capabilities (for example, a finance lead who is also a team manager).
   - Each nav item, page, tab, card, stat, quick action, search result and button shows only if the user has the permission for it.
   - **Home selection:**
     - People with admin-dashboard access see the admin dashboard.
     - Everyone else sees the self-service Home.
     - People with team permissions (for example `attendance.team.read` or `hrms.leave.approve.l1`) also get the "My team" group and the team blocks on Home.
   - **Do not build the "Viewing as" role switcher.** It exists in the prototype only so reviewers can compare roles. The deployed product shows each user only their own experience, from their own permissions.
   - Keep the existing role and permission logic on the server as the source of truth. The UI only mirrors it.
4. **Consistency first: build shared components and use them everywhere.**
   - Before restyling pages, create or extend one shared set in `apps/platform/src/design/` (extend `design/module/ModuleKit` and `shared/components/hr` rather than duplicating them):
     - `PageHeader`
     - `PillTabs`
     - `SearchPill`
     - `StatCard` (icon, label, value, note, sparkline, accent)
     - `QuickActionTile`
     - `Card` / `Section`
     - `ListRow`
     - `StatusPill`
     - `ApprovalRow` (inline approve/reject + undo)
     - `SegmentedControl`
     - `FilterPills`
     - `MonthCalendar` (day states + legend)
     - `Meter` / `ProgressBar`
     - `Ring` (geofence / progress)
     - `Avatar`
     - `EmptyState`
     - `Skeleton`
     - `Toast`
     - `Popover` / `Menu`
     - `Dropdown` with search
     - `SidePanel` (square-edged, stepper, sticky footer)
     - `Dialog`
     - `FormField` (input, select, textarea, toggle, slider)
   - Put tokens in one place (CSS variables or the theme file): colours, dark theme, type scale, spacing, radii, shadows, motion. Use them instead of hex values in components.
   - Every page in the module, for every role, must use these shared pieces. Replace one-off styling as you touch each page. If two pages show the same kind of thing (a stat, a request row, an approval, a calendar), they must use the same component.
5. **Visual rules** (details and exact values are in the README):
   - Font: **Plus Jakarta Sans**, weights **400/500/600 only**. Nothing bolder than 600 anywhere. Tabular numbers for figures.
   - **Every page** uses the new top bar:
     - Outlined pill tabs for the page's own tabs, with the active one solid green. Keep the tab names and order unchanged.
     - Pages without tabs show a single solid pill with the icon and page name.
     - Then the pill search with ⌘K and the bell. No "Viewing as" control.
   - The admin dashboard defaults to the outlined-pill section header and the quick-action **tile row**.
   - The rail collapses to 72px, with no label text leaking when collapsed.
   - The More panel matches the README exactly. It has no business apps, no search and no Alerts.
   - Content lives on white cards. No dark-green filled blocks inside pages.
   - Side panels have square edges with a 1px left border. Menus, popovers and dialogs use a 12px radius. The backdrop is a gradient with a soft blur. Apply this to **every** existing modal, drawer and pop-up in the module, not just the new ones.
   - Motion follows `prototype/hrms-fx.js` (rise, count-up, bar grow, ring draw, hover spotlight). It must respect `prefers-reduced-motion`.
   - Must be responsive (self-service must work on mobile widths), with accessible labels, contrast of at least 4.5:1 and visible focus.

## Plan (one PR or commit per phase; stop after Phase 0 for my review)

- **Phase 0: Audit (no code changes).**
  - Map every prototype screen to our route, container and hooks, using the table in the README.
  - For each screen, list every data point and action, the hook or endpoint that provides it, and any **gaps** (missing endpoint, missing permission, missing field).
  - List the permission keys that drive each nav item, card and action.
  - Give me this as a markdown table plus your questions. Wait for my go-ahead.
- **Phase 1: Foundations.**
  - Tokens, the font (loaded once, with fallbacks) and the shared components listed above, with stories or tests if we have them.
  - The shell: rail, top bar (pill tabs, search pill, bell), the More panel, the ⌘K search scoped by permission, notifications.
  - Permission-driven navigation for any role.
- **Phase 2: Admin pages.**
  - Dashboard (tile row default) and every admin module page, restyled with the shared components.
  - The same data, actions and behaviour.
- **Phase 3: Self-service.**
  - Home, Time (calendar, day detail, fix a day, timesheet, WFH, shift change), Leave (overview, apply planner, requests, holidays), Pay (payslips, salary, claims, advances), Documents (letters, documents, assets, policies), Growth (reviews and goals, learning).
  - All on real data.
- **Phase 4: Team.**
  - Team today, Team schedule, and one Approvals inbox covering leave, attendance fixes, WFH, shift changes and expenses.
  - All driven by team and approval permissions and scoped by the API to the manager's reports.
- **Phase 5: Companies & branches.**
  - Company dropdown with search, company detail, registration, branches (cards and table), geofence rings.
  - Side panels for Create branch, Add company and Manage branch, wired to the real create, update and archive APIs and to geofence radius storage.
- **Phase 6: Profiles.**
  - Use `design_handoff_hrms_redesign/assets/profile-banner.png` as the profile banner (copy it into the app's assets).
  - The new profile layout (banner, left card, tabbed right card) for the HR view of any employee and for "My profile" of any user.
  - Tabs and fields gated by permission; self-edits go through the real profile API.
- **Phase 7: Pop-ups everywhere.**
  - Convert every remaining modal, drawer and confirm dialog in the module to the shared `SidePanel`/`Dialog`.
- **Phase 8: QA.**
  - Run the whole module as at least these users: owner, HR manager, finance lead, department manager, plain employee, and one custom role with a narrow permission set.
  - Confirm that each sees only what they're allowed, nothing crashes, empty tenants look right, dark mode works, and there are no console errors.
  - Fix everything, then give me a summary of what changed, what's still pending and any backend follow-ups.

## Design-system sync (do this at the end)
- In `styles.css`, move real theme tokens out of component selectors into `:root`/`[data-theme]`.
- Add `/* @kind other */` after the motion tokens (`--ease-*`, `--motion-*`) and the z-index tokens (`--z-*`).
- Then re-run `/design-sync`.

## Definition of done

- No mock or static data anywhere. Every screen shows live data and every action persists.
- No regressions: every existing test passes, and flows still work (leave apply and approve, attendance, payroll run, payslips, expenses, hiring, onboarding, letters, reports, settings).
- Any role, including custom roles, gets the right navigation, Home, tabs and actions from permissions alone.
- One shared component set and one token set, used consistently across every page and role.
- Plus Jakarta Sans at weights 400–600 only. Pill-tab header on every page. New More panel. Square side panels with the gradient-blur backdrop.
- Loading, empty and error states everywhere. Responsive and accessible.

If anything in the design conflicts with an existing behaviour or a permission rule, keep the behaviour, tell me, and suggest how to adapt the design. Ask me whenever you're unsure. Don't guess.
