# HRMS redesign — rules for every builder agent (read fully before starting)

Also read, fully: `/c/REACT/ut-wt/_tools/RULES.md` (worktree-only edits, heavy.sh memory guard, the shared live-test slot,
production safety, style), `/c/REACT/ut-wt/redesign/DECISIONS.md` (the user's binding decisions), and the design handoff
`/c/REACT/ut-wt/design-ref/design_handoff_hrms_redesign/README.md` + `CLAUDE_CODE_PROMPT.md`.
When it exists, `/c/REACT/ut-wt/redesign/AUDIT.md` is the screen-by-screen map (data sources, gaps, permissions).

## The user's rules (verbatim, non-negotiable)
"all of the pages same to same", "dont create anything static everything should be end to end called with the apis
from backend nothing should be dummy or static", "dont mess up anything", "i want you to not create new things or new
problems", "do this very carefully by thoroughly checking and doing the testing".

## The design is the visual source of truth — compare side by side
- The prototype is served at `http://127.0.0.1:3900/` (folder `design_handoff_hrms_redesign/prototype`).
  Screens: `http://127.0.0.1:3900/HrmsPlatform.dc.html#<role>/<moduleKey>/<pageKey>/<tabIndex>` with role = admin |
  manager | employee and the module/page keys from `hrms-core.js` (window.UTCore.M). Components: `StyleGuide.dc.html`,
  `Ut*.dc.html` open directly. Screen index: `ReviewBoard.dc.html`.
- Screenshot helper (prototype): `node /c/Users/LENOVO/AppData/Local/Temp/claude/c--REACT-unifiedtree-saas/4c95e1ec-1e64-402e-b1d5-7936d6ba1b34/scratchpad/proto-shot.mjs "#admin/dashboard/dashboard/0" out.png 1440`
  (run from any `apps/platform` folder; it imports Playwright from the main checkout).
- **Reference screenshots of every prototype screen** (each role, page and tab; light and dark; 1440 and 390; plus the
  open More panel, search, bell and Pages panel) are in `/c/REACT/ut-wt/redesign/ref/<role>/<module>__<page>__<tab>__<theme>__<width>.png`
  and `ref/shell/`. `ref/index.json` maps each file to its module, page and tab labels. Re-capture one role with
  `node /c/REACT/ut-wt/redesign/proto-capture.mjs <role> 1440 light` (run from an `apps/platform` folder).
  The design's OWN dark mode is incomplete: some raw-hex pieces stay light, such as the calendar cells and the
  profile card. Our dark mode uses tokens everywhere, so in dark follow the tokens, not those light leftovers.
- Read exact values (colours, sizes, spacing, radii, shadows, copy) from the `.dc.html` inline styles. Match them.
  Take screenshots of your implementation at the same width (1440 and 390) in light AND dark, put them next to the
  prototype's, look at both with the Read tool, and fix differences before you report done.
- The prototype's `<script type="text/x-dc">` logic and `hrms-data.js` / `emp-data.js` / `hrms-dash.js` are SAMPLE
  DATA. Never port a number, name, date or list from them. Every value comes from the backend via real hooks.

## Tokens (the contract every package uses)
CSS variables named exactly as the design uses them, set on `:root` (light) and `[data-theme="dark"]` (dark) by the
theme package. Write components with the design's own fallback form, e.g. `var(--u-sf,#fff)`, so they render right
even before the theme lands. Light defaults / dark values:
`--u-bg #F3F6F4 / #0A110E` · `--u-sf #fff / #101915` · `--u-sf2 #F7F9F8 / #0D1512` · `--u-hv #F0F4F2 / #16211C` ·
`--u-ln #E3E9E6 / #1F2C27` · `--u-ln2 #EDF1EF / #18231F` · `--u-ink #0E1B16 / #E6EEEA` · `--u-ink2 #4A5A54 / #A7B6B0` ·
`--u-ink3 #6A7A73 / #80918A` · `--u-br #0F6E56` (brand solid, same in both) · `--u-brt #0F6E56 / #5CC4A3` (brand text) ·
`--u-brs #E8F3EE / #10271F` · `--u-brs2 #D2EADF / #16362B` · `--u-brl #BFDFD1 / #22503F` · `--u-g2 #5FB39C / #3F9C84` ·
`--u-g3 #A9D6C6 / #2B5C4E` · `--u-gy #C9D2CE / #3A4843` · `--u-gd #C8912E / #D9A441` · `--u-gdt #8A5A10 / #E6B865` ·
`--u-gds #FAF1E1 / #2A2113` · `--u-rd #C4453A / #E0645A` · `--u-rdt #B42318 / #F18B80` · `--u-rds #FCEDEB / #2C1715` ·
`--u-ov rgba(14,27,22,.36) / rgba(0,0,0,.55)` · shadows `--u-shc 0 1px 2px rgba(14,27,22,.05) / 0 1px 2px rgba(0,0,0,.5)`,
`--u-shh` (raised), `--u-shp 0 24px 60px -20px rgba(14,27,22,.35) / 0 24px 60px -20px rgba(0,0,0,.8)` ·
`--u-font 'Plus Jakarta Sans', system-ui, sans-serif` · `--u-railx 248px`. Status colours (info blue, leave orange,
holiday purple, amber, stat-card accents) are in README "Design tokens" — the theme package adds them as variables too
(names documented in `apps/platform/src/design/theme/tokens.css` once it exists).
Font weights 400/500/600 only; `font-variant-numeric: tabular-nums` for figures. Never hardcode a hex in a component
except as the design's `var(--u-x, #fallback)`.

## Shared kit (build once, use everywhere)
`apps/platform/src/design/kit/` — typed React components, named exports, accessible (labels on icon buttons, focus ring
`box-shadow: 0 0 0 3px var(--u-brs)` + brand border, Esc closes popovers/panels), responsive
(`repeat(auto-fit, minmax(min(100%, Npx), 1fr))`), dark-mode safe (only `var(--u-*)`), `prefers-reduced-motion` respected.
Motion helpers live in `apps/platform/src/design/theme/motion.ts` + `motion.css` (rise, pop-in, count-up 950ms, bar grow
750ms stagger 35ms, ring draw 1000ms, tile spotlight/tilt; easing `cubic-bezier(.2,.8,.2,1)`; levels via
`[data-ufx=full|subtle|off]`). Pages never re-implement a kit piece; if a kit piece is missing something, extend it
(coordinate through your report) rather than copying it.

## Behaviour must not change (unless the design adds something)
Keep every route/URL, redirect, permission check, React Query hook and key, mutation, validation, analytics event and
test behaviour. Earlier client decisions stay: settings live in their own sections (Master rules & policies, Payroll
settings, Expenses policies, HR setup, workspace Settings at /settings/*, /roles, /users, /audit-logs); My Attendance is
hidden for OWNER/ADMIN/SUPER_ADMIN; greeting = first name, or full name if the first name has <2 letters; the shared
calendar `src/shared/components/calendar` for every date field; railLit.ts rail-highlight rule; companies Inactive
view + restore + archive guards; dashboard follows ?date=; analytics ?month=; milestones ranges.
Roles are never hardcoded: every nav item, page, tab, card, stat, quick action, search result and button shows only with
its permission (usePermission / useAnyPermission / PermissionGate / pageRegistry menu rules).

## Tests
tsc clean, eslint 0 errors on changed files, `vite build` passes, vitest for any unit you add, backend tests for any
backend you touch. Live tests in `apps/platform/e2e/recovery/` (see RULES.md for the slot): add a `live-rd-<package>.mjs`
that checks your pages for real data, permissions (owner, hrm, fin, mgr, reader) and both themes, and cleans up. When
markup changes break an EXISTING live test, update its selectors but keep every behavioural assertion (never delete a
check to make it pass; if behaviour truly changed by design, say so in your report).
Commit on your branch with plain-English messages ending in
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push.

## Shell contracts (the shell package implements these; page packages use them; neither side changes them without the lead)
1. **Header tabs:** `import { HeaderTabs } from '@/design/shell/HeaderTabs'`
   - Props: `{ label: string /* e.g. "Leave views" */, items: { key: string; label: string; count?: number; urgent?: boolean }[], active: string, onChange(key): void, semantics?: 'views' | 'tabs' }`.
   - It renders the design's outlined pill tabs (kit `PillTabs`) inside the TOP BAR, through a portal into the shell's
     header slot. When no slot is mounted (tests, or a page shown outside the shell) it renders inline, in place.
   - Only a page's TOP-LEVEL bar goes to the header. The slot holds one bar; a nested bar stays inline as the design's
     inline pills or filter pills.
   - Semantics stay as today: `'views'` (default) = `role="group" aria-label={label}` + `aria-pressed` buttons, as
     ModuleKit `Views` does today; `'tabs'` = `role="tablist"` + `role="tab"` + `aria-selected`, for bars that use tab roles today.
     Counts and urgent counts stay.
   - `ModuleKit.Views` and `design/dc/SubTabs` get an optional `placement?: 'header' | 'inline'`, **default
     `'inline'`** (today's behaviour). Each page package sets `placement="header"` on its page's top-level bar.
     Pages not yet migrated keep working unchanged.
   - When a page publishes no bar, the shell shows the page's name as one solid pill (design).
   - The module's pages (today's "<Module> sections" row under the header) move into the shell's Pages button and
     Pages panel. The shell owns that; pages do nothing.
2. **Page title:** pages render the kit `PageHeader` at the top of their own content (title or greeting, sub-line,
   right-side actions). The shell never renders page titles.
3. **Rail highlight** comes only from `src/layouts/railLit.ts` (shell). Pages never set it.
4. **Toast:** the kit Toast through the existing `useDesignToast` / `useSettingsToast` (F2b makes them render it).
   **Pop-ups:** kit `SidePanel` / `Dialog` / `Menu` / `Popover`. HrDrawer and ui-kit Modal are restyled in place by F2b,
   so existing callers get the new look without changes.
5. **Home:** the shell owns `/dashboard` → `/me` routing and `useHome()`. The Dashboard and ESS Home packages own
   what renders on those pages.

## Environment notes (27 Sep, from the foundation builders)
- **Screenshots use the STABLE backend on :8070.** It runs the main jar against DB `unifiedtree_recovery`, and live
  slots never touch it, so your session survives other agents' test runs. Run your own vite with
  `VITE_PROXY_TARGET=http://127.0.0.1:8070 npx vite --port <your port> --strictPort` and open `http://demo.localhost:<port>`.
  If it's down, run `/c/REACT/ut-wt/_tools/stable-backend.sh` (don't restart it otherwise). It is the long-lived DB:
  remove anything you create there.
- **Backend changes** (your own jar) can only be seen in the live slot (`live-slot.sh`, :8080 with a fresh DB).
  Slots no longer restart anything when they finish.
- **Never run `scripts/design-build.mjs`.** Regenerating the old `design/dc/*.view.tsx` brings Inter and the old colours
  back. A page you migrate is rebuilt by hand on the kit, not regenerated.
- **Dark mode:** `apps/platform/src/design/theme/dark-bridge.css` temporarily keeps pages that aren't rebuilt yet
  readable in dark. Your rebuilt pages must use only tokens and must NOT rely on the bridge. Don't edit or delete bridge
  sections; the lead removes them at the end.
- **Kit APIs:** read the barrels `src/design/kit/display.ts` (+ `overlays.ts` once F2b lands) and
  `src/design/theme/index.ts` / `motion.ts`.
  - Data states: `<Section loading error onRetry retrying empty>`.
  - Nested cards take `cardClass={false}`, so `.ut-card` test locators still match once.
  - The theme API is `useTheme()` from `@/design/theme`; the storage key stays `ut.theme`.
- **Token names** are listed at the top of `src/design/theme/tokens.css`. Use them. Never add raw hex.
- **Live-slot contention:** the single live slot is the bottleneck with many builders.
  - While iterating, frontend-only packages may run their live test against the STABLE backend: your vite on
    :8070 + `RECOVERY_APP_URL=http://demo.localhost:<port> RECOVERY_API_URL=http://127.0.0.1:8070/api node e2e/recovery/<test>.mjs`.
  - The **final green run** that you report must go through `live-slot.sh` (fresh DB, isolated).
  - Tests must never depend on exact global counts that other agents' tests could change (a count of YOUR fixtures is fine).
- **NEVER start vite without a local `VITE_PROXY_TARGET`.** Without it, `apps/platform` proxies `/api` to the
  **production API** (`https://api.unifiedtree.com`); on 27 Sep an agent's stray vite sent demo sign-ins there. Start
  your web app ONLY with `/c/REACT/ut-wt/_tools/vite.sh <your worktree> <port>`, which targets the stable backend :8070
  and refuses any non-local target. Stop it by port when done (`TaskStop` can leave node listening), and before any
  test run check that nothing else is still listening on your port.
- **Toasts:** use the kit `useToast()` (`@/design/kit/overlays`). Convert the sonner `toast.*` calls on your pages to it.
  **z-index:** SidePanel 1000, Dialog 1100, Popover 1200, Toast 1400, ConfirmDialog 9999, calendar 10001.
- **Buttons:** the kit `Button` (F2a) for pages; `PanelButton` (F2b) for side-panel footers.
- **Baseline (G0, main e32a4dc6):** `/c/REACT/ut-wt/_results/baseline-e32a4dc6/BASELINE.md` lists every existing live script that
  already fails, with its FAIL lines, and the per-script logs sit next to it. It was run on the stable backend :8070, so
  scripts that hardcode :8080 (live-role-matrix, live-summary-notices) and live-settings-restored (needs a "before" app
  on :3050) fail for environment reasons. When one of your scripts fails, compare with the baseline first. A failure that
  is already in the baseline is not yours, but still fix it if it's on your pages and the fix is in your scope.
- **Generated files (F4, merged):** `design-build.mjs` and `master-build.mjs` skip any output whose first line is
  `// hand-owned` (CSS: `/* hand-owned */`). **Whoever hand-edits a generated file adds that marker as its first line, in the
  same commit.** Scaffold a page from the handoff once (never regenerate over your edits) with
  `node scripts/dc-to-tsx.mjs --folder /c/REACT/ut-wt/design-ref/design_handoff_hrms_redesign/prototype <empty folder> PgLeave`.
  Re-capture reference shots with `node e2e/capture-handoff.mjs <role> 1440 light` (from apps/platform; `--only`, `--out`).
- `MasterDesign.tsx` is marked hand-owned. P-WF-SETUP edits it by hand, keeping the existing hand edits (the DateField
  wiring and the policies route status/q).
- **Commit early and often.** On 27 Sep every agent was stopped at once by a usage limit, and uncommitted work survives
  only by luck. Commit each coherent piece as soon as it passes tsc (with tests if it's backend). Never keep hours of work uncommitted.
- **Scripts that write SQL straight to `unifiedtree_recovery`:** `live-design-leave`, `live-leave-calendar` (now take `RECOVERY_DB`),
  and `live-backend-fixes` (NOT yet). Inside a slot, always pass `RECOVERY_DB=ut_w3_dev`, and never run a script that
  hard-codes the recovery DB inside a slot.

## SHELL CONTRACT UPDATE (1 Oct, DECISIONS 21). This replaces item 1 above where they differ
- The header now shows the current **module's pages** as top tabs (the shell does this from the registry; the left
  Pages panel is gone).
- A page's OWN views/sub-sections are **inline pill tabs inside the page**, under the header. Use `ModuleKit.Views` /
  kit `PillTabs` with the default `placement="inline"`. **Do NOT use `placement="header"` or `HeaderTabs` for page views.**
- Keep each bar's semantics (`role=group` + `aria-pressed`, or tabs) and its counts.
- Font = **Inter** (via `var(--u-font)`; never hard-code a font). Greeting = full name (the shared greeting util).
- "Upcoming milestones" is now called **"Upcoming events"**.
