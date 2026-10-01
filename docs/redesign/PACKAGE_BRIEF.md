# Brief for every redesign page/backend package (read fully, then your own task section)

## Before you write code
1. Read fully:
   - `/c/REACT/ut-wt/_tools/RULES.md`
   - `/c/REACT/ut-wt/redesign/REDESIGN_RULES.md` (tokens, kit, the SHELL CONTRACTS, tests)
   - `/c/REACT/ut-wt/redesign/DECISIONS.md` (binding)
   - `/c/REACT/ut-wt/redesign/AUDIT.md`: the whole plan, then your package's section
   - `/c/REACT/ut-wt/redesign/AUDIT-ADDENDUM.md`: the lead's corrections to AUDIT.md (binding; it wins where they differ)
   - `/c/REACT/ut-wt/redesign/CONTRACTS.md`: the shared endpoints, hooks, new permissions and notification types (C0)
   - your area audit(s) in `/c/REACT/ut-wt/redesign/audit/`
   - the design handoff `README.md` + `CLAUDE_CODE_PROMPT.md` in `/c/REACT/ut-wt/design-ref/design_handoff_hrms_redesign/`
2. Open your screens in the prototype (`http://127.0.0.1:3900/HrmsPlatform.dc.html#<role>/<module>/<page>/<tab>`)
   and in `/c/REACT/ut-wt/redesign/ref/` (full-height, light/dark, 1440/390). Read the `.dc.html` files for exact values.
3. Read the current code of every page you own, its hooks and API calls, its tests (unit + `e2e/recovery/live-*.mjs`),
   and the backend endpoints it calls. Know what it does today before you change how it looks.

## How to build
- Your worktree/branch is given in your task. Base = `rd/int` (it has the theme, the kit and the shell contracts).
  Work ONLY in your worktree. Stage explicit paths. Commit as you finish coherent pieces. Never push.
- Compose pages from the kit (`src/design/kit/…`, `src/design/theme/…`). If the kit lacks something you need,
  add it in your package ONLY as a small local wrapper, and say so in your report; never copy a kit piece.
  The lead folds useful additions back into the kit.
- **Same to same:** layout, spacing, sizes, radii, colours (via `var(--u-*, fallback)`), copy and the order of blocks
  follow the prototype. Tab names and order stay as today (DECISIONS 11). Every number, name, date, list and
  chart comes from real API data. When the design shows something the backend doesn't provide, and your task does
  not include building it: render nothing for it (never a sample value), and list it under `gaps_left`.
- Keep behaviour: every route, `?query` param, permission check, React Query key, mutation, validation, error and empty
  state. A pop-up that exists today still opens from the same place, and does the same thing, in the new style.
- Every pop-up your pages open (drawers, modals, confirms, menus) moves to the kit SidePanel/Dialog/Menu, including
  hand-rolled overlays and `window.confirm/alert`. Keep `role="dialog"` + accessible names, and keep existing test labels
  ("Close panel", "Try again") unless you update the tests that use them.
- Dark mode: only tokens. Check every page in dark. Brand text uses `var(--u-brt)`.
- Font: Plus Jakarta Sans via inheritance. Weights 400/500/600 only. Tabular figures.
- Phones (390 px): no sideways page scroll. Tables scroll inside their card or become cards (as the design's mobile hints do).
- Backend work (only if your task lists it): JdbcTemplate for new tables/columns. No JPA-mapped column changes.
  Idempotent migration with your reserved version. New permissions granted to OWNER + SUPER_ADMIN and added to the
  Roles & permissions catalogue. Tenant-scoped. `@PreAuthorize` on every endpoint. Unit tests. The UI degrades per
  block (hidden/empty/error) when the endpoint or migration is missing.

## How to test (all must pass before you report done)
- `tsc` clean, `eslint` 0 errors on changed files, `vite build` passes (all through `heavy.sh`), `vitest` for units you add,
  backend tests for modules you touch.
- A live test `apps/platform/e2e/recovery/live-rd-<package>.mjs`, run through `live-slot.sh`. It must check:
  - your pages render with REAL data
  - no page errors, and no 4xx/5xx you didn't expect
  - permissions: owner, hrm, fin, mgr, reader, and a custom role if relevant; each sees only what they may
  - light AND dark
  - the main actions work end to end
  - it removes everything it creates
- EXISTING live tests that cover your pages (list them from REDESIGN_RULES/AUDIT or grep `e2e/recovery`): run them. If
  new markup breaks them, update selectors but keep EVERY behavioural assertion.
- Screenshots of your pages: 1440 + 390, light + dark, next to the prototype's. Look at them with Read and fix the
  differences. Save them to `/c/REACT/ut-wt/_results/shots/rd-<package>-*.png`.
- Keep your vite dev server running only while you use it (the PC is short on memory).

## Your final report (your last message; the lead reads only this)
```
package, branch, commits (hash + one line each)
pages: [{ route, prototype screen(s), status: done|partial, screenshot paths }]
backend: [{ endpoint/migration/permission, tests }]
tests: { tsc, eslint, build, vitest, live-rd-<package>: n/n, existing live tests run: [{ file, result, selector changes }] }
behaviour_changes: [anything a user would notice beyond the look, and why the design requires it]
decisions_made: [choices you made where the docs were silent]
gaps_left: [design pieces not built, and why]
risks: [anything the lead should re-check at integration]
```
