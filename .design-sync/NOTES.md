# design-sync notes — UnifiedTree HRMS

Repo-specific facts a re-sync needs. One bullet per gotcha. Keep the
**Re-sync risks** section current — it is the watch-list the next run reads first.

## Shape and entry

- **No Storybook anywhere in the monorepo** (searched `.storybook/main.*`,
  `storybook/main.*`, `*.stories.*` excluding node_modules — nothing). Package shape.
- **The synced package is not a real package.** `packages/ui-kit` is source-only
  (`main: ./src/index.ts`, no build, no dist) and the HRMS primitives the screens are
  actually built from live in `apps/platform/src/shared/components/` (not a package).
  Both layers export `DataTable`, `EmptyState` and `StatCard`. So the sync entry is
  `.design-sync/ds-package/src/index.ts` — a barrel that re-exports ui-kit minus those
  three names and takes the HRMS versions instead. One namespace, names match the code.
  The app never imports it.
- `cfg.entry` (`.design-sync/ds-package/src/index.ts`) is what makes the converter use
  that directory as the package — without it PKG_DIR defaults to
  `<node_modules>/@unifiedtree/design-sync-entry`, which never exists, and the build
  dies with ENOENT on its package.json. `entry` is **cwd-relative** (not config-relative):
  always run the converter/driver from the repo root.
- Every `componentSrcMap` entry is **package-relative to `.design-sync/ds-package/`**
  (cfgPath resolves against PKG_DIR), hence the `../../` prefixes.
- `Toaster` is sonner's component re-exported by ui-kit — no repo source, renders
  nothing without a toast. Excluded from cards (`"Toaster": null`), still in the bundle.

## Styling

- **No shipped stylesheet exists.** The look is Tailwind utilities + the app's
  `.ut-card / .ut-card-hover / .ut-card-lg / .ut-card-sm / .ut-glass / .ut-ground /
  .ut-input / .ut-select / .hr-table` classes from `apps/platform/src/globals.css`,
  compiled against `apps/platform/tailwind.config.js` (preset:
  `@unifiedtree/design-system/tailwind-preset.cjs`; content globs cover
  `packages/ui-kit/src` and `apps/platform/src`). `buildCmd` = `.design-sync/build-ds.mjs`
  runs exactly that compile with the app's own config → `ds-package/dist/styles.css`.
- `cssEntry` must stay **inside `ds-package/`** — the converter bounds it to PKG_DIR
  (uploaded verbatim). That is why the CSS is emitted under `ds-package/dist/`.
- Tailwind CLI's postcss-import cannot resolve the bare
  `@import '@unifiedtree/design-system/tokens.css'` (Vite can). build-ds.mjs rewrites it to
  the relative path in a temp input file beside globals.css and removes it after.
- Tokens: `packages/design-system/src/tokens.css` — CSS custom properties, light default,
  dark via `[data-theme='dark']`. Brand emerald `--accent-fg: #0f6e56`, mint `#10b981`.
  The app's `tailwind.config.js` also hard-codes `#059669` in places.
- **Fonts are runtime Google Fonts** (Plus Jakarta Sans, Inter, JetBrains Mono) via a
  `<link>` in `apps/platform/index.html`; no `@font-face` in the repo. build-ds.mjs
  prepends the Google Fonts `@import url()` to styles.css so validate reports
  `[FONT_REMOTE]`, not `[FONT_MISSING]`. Designs need network access to render the
  brand fonts; the fallback stack is `-apple-system, Segoe UI, Roboto, sans-serif`.

## Toolchain

- pnpm 9.15.0 (`packageManager`), node 20.18.0 (`.nvmrc`). Install: `pnpm i --frozen-lockfile`.
- `react`/`react-dom` 18.3.1 resolve from `packages/ui-kit/node_modules` and
  `apps/platform/node_modules` — **not** the repo root (pnpm, no hoist). Pass
  **`--node-modules apps/platform/node_modules`** to the converter and the driver: it is
  the only node_modules where `@unifiedtree/design-system` is linked (needed by
  `tokensPkg`) and it has `lucide-react`/`framer-motion`/`sonner` for authored previews.
  ui-kit's own deps (`@radix-ui/*`, `class-variance-authority`) are NOT there — esbuild
  still finds them by walking up from `packages/ui-kit/src`, so the bundle is unaffected.
- **`.design-sync/ds-package/node_modules` is a junction → `apps/platform/node_modules`**,
  created by `build-ds.mjs`. The converter's `.d.ts` step finds `@types/react` by walking
  UP from the entry package for `node_modules/@types/react`; with pnpm the walk finds
  nothing, React utility types become `any`, and every ui-kit component whose props
  extend `React.*HTMLAttributes` (Button, Input, Badge, Tabs, Modal…) emits an EMPTY
  props body (`[DTS_REACT]` in the build log). The junction is gitignored (`node_modules`
  rule) — a fresh clone gets it back by running `buildCmd`, which every sync must do first.
- Tokens: `tokensPkg: @unifiedtree/design-system` + `tokensGlob: src/tokens.css` copies
  `tokens.css` to `tokens/` so the design agent can read token names. The same custom
  properties are ALSO inside `_ds_bundle.css` (globals.css imports tokens.css — that is
  what the app ships). Identical values defined twice is harmless; keep it that way rather
  than stripping the import from the compile — the compiled CSS must stay byte-faithful
  to the app.
- esbuild 0.21.5 and tailwindcss 3.4.19 are in the pnpm store, not root `.bin`;
  build-ds.mjs resolves tailwind via `createRequire` from `apps/platform`.
- Render check: playwright-core@1.60.0 pins chromium **1223**; the Windows cache
  (`%LOCALAPPDATA%\ms-playwright`) has chromium-1223 and chromium-1243. `playwright@1.60.0`
  is installed into `.ds-sync/` for `package-validate.mjs`.

## Context-dependent components (compose in previews, never standalone)

- `TabsList` / `TabsTrigger` / `TabsContent` read `TabsContext` — preview them as a full
  `<Tabs>` composition. `HrTabs` + `HrTabPanel` are independent (props-driven).
- `ConfirmDialogProvider` + `useConfirmDialog()` — promise-based, opens on a call, no
  static open state. Floor card by design.
- `HrDrawer` / `Modal` / `Drawer` render through `createPortal` — need
  `cardMode: single` + a viewport override once authored.
- `DataTable` (and any full-width table/bar) uses `cardMode: column` so each story gets
  the full card width instead of a grid cell.

## Preview authoring (40 components, 134 cells, all graded good — 2026-09-23)

- Contract: `.design-sync/previews/<Name>.tsx`, named exports = cells, imports from
  `'@unifiedtree/design-sync-entry'` (shimmed to `window.UnifiedTree`). Third-party imports
  (`lucide-react`, `framer-motion`) bundle from `apps/platform/node_modules`. Google Fonts
  load in headless chromium — Plus Jakarta Sans renders in every capture.
- **Card width is the first thing to get right.** Grid cells are ~400px; `cardMode: "column"`
  gives 900px (KPI strips, tables, toolbars, headers, tab bars); `cardMode: "single"` +
  `viewport: "960x640"` for overlays. Captures are viewport-only screenshots — a cell taller
  than ~650px is clipped (Drawer `PayslipDetail` lost a button until a fact row was dropped).
- **Never author `grid-cols-4`** — the purge kept only `grid-cols-2/3` and `sm:/xl:grid-cols-4`.
  Also absent: `text-indigo-600`, `text-sky-600`, `shadow-2xs` (the last is a silent no-op in
  the app too). Check with `grep -F` on the escaped selector — a regex grep under-reports
  because Tailwind escapes `/ [ ] : .`.
- `cn()` is twMerge-based, so a preview's `className` cleanly replaces a component's own
  conflicting classes (`flex-row` over `CardHeader`'s `flex-col`, `rounded-lg` over Skeleton's
  `rounded-md`).
- Repo details worth keeping: `<input type="date">` already paints Chromium's picker icon (no
  calendar `rightElement`); vertical `Separator` is `h-full border-l` and needs an explicit
  parent height; header-less `CardContent` needs `pt-5`; payroll `statusTone` lives in
  `modules/hrms/api/usePayrollRuns.ts`.
- **States skipped by design** (recorded so a re-sync doesn't chase them): all hover / focus /
  active pseudo-states; `Button asChild` and `TabsTrigger disabled` (pixel-identical);
  `Card interactive`'s hover lift; `HrSelect`'s open listbox and `HrTabs`' overflow scroll
  (click-only internal state); `Modal preventOutsideClose` (behaviour-only); FilterBar
  `hidden: true` and `HrPagination` with `totalPages <= 1` (render null by construction);
  `DataTable loading` (its `bg-white/50` skeleton rows are invisible on a white card — the
  app renders that too); exit animations.
- Avatar `src` uses an inline data-URI SVG, not a remote photo, so the cell renders offline.

## Capture harness fix — do NOT reintroduce a fake clock

- `.ds-sync/package-capture.mjs` originally pinned the page clock with
  `page.clock.setFixedTime(...)`. Any `page.clock.*` form also drives `performance.now()`/rAF,
  and its counter keeps running across navigations while each new document restarts at 0, so
  framer-motion computes a bogus elapsed and **every entrance tween sticks at its initial
  keyframe** — HrDrawer, Modal, Drawer and StatCard all captured as blank white cards.
  (`install()` + `runFor()` does not fix it either; re-applying `setFixedTime` after each goto
  fixes only the first story.)
- The fix in place: `page.addInitScript` freezes **only `Date`** (it re-runs on every document),
  and the screenshot passes `animations: 'disabled'` so finite WAAPI tweens land on their end
  state. This is a local edit to the staged script — **re-apply it after any `cp -r` refresh
  of `.ds-sync/`**, or the overlay cards go blank again.

## App findings surfaced by the previews (NOT fixed here — shared styling is the UI track's)

- `apps/platform/src/globals.css` declares `.ut-select { width: 100% }` outside any `@layer`,
  so in the compiled sheet it lands after Tailwind's utilities and beats `w-auto`. Inside
  `TableCard`'s shrink-to-fit toolbar every select takes its 200px max-width and a second one
  wraps to its own line — visible in the TableCard `SearchFiltersActions` card, and on every
  app screen with 2+ select filters. Fix would be moving `.ut-input/.ut-select` into
  `@layer components`. The card is graded good because it is the app'sreal render.
- `@unifiedtree/ui-kit`'s `Tabs` is styled for a dark surface (slate-700/800, indigo active).
  On the white DS card it reads as a dark-mode widget and the active `cards` chip is low
  contrast — and indigo, not the app's emerald. HRMS screens use `HrTabs`; the conventions
  header steers the design agent to `HrTabs`.
## Re-sync risks

- **`.ds-sync/package-capture.mjs` carries a local patch** (see "Capture harness fix" above):
  the staged copy is regenerated by every `cp -r` of the skill scripts, and the upstream
  version pins a fake page clock that blanks every framer-motion overlay/StatCard capture.
  After re-copying `.ds-sync/`, re-apply the patch BEFORE any capture, or those grades
  will be cleared and the sheets will come back white.
- `ds-package/dist/styles.css` is **gitignored build output** — a fresh clone must run
  `buildCmd` before the converter or `cssEntry` is "not found — skipped" and every card
  renders unstyled. The converter does not run buildCmd itself.
- The compiled CSS is **purged to the app's actual usage** (content globs). A utility
  class a preview uses that no app screen uses will be missing from styles.css even
  though it is a valid token class. Author previews with classes the app already uses,
  or add the file to the app's `content` globs.
- Google Fonts is a network dependency at render time (validate + design app).
- The HRMS layer is `apps/platform/src/shared/components/*` — any rename/move there
  breaks `componentSrcMap` paths and the barrel's relative imports (validate will
  report `! componentSrcMap: ... not found`).

## Sync scope decisions (2026-09-23, first sync)

- **Component scope:** tokens + ui-kit + HRMS primitives (all three layers), 45 components.
- **Preview scope:** author all meaningful components (~40). Floor cards by design for
  `ConfirmDialogProvider` (promise-driven, no static open state), `SkeletonBlock`,
  `SkeletonRow`, `SkeletonCardGrid` (trivial). `Toaster` excluded from cards entirely.
- Project: **UnifiedTree HRMS Design System** — https://claude.ai/design/p/00b3efa9-2fcf-413b-b54b-efd18bbbaccb
  (created 2026-09-23 as a fresh target at the user's request; the first project,
  **UnifiedTree HRMS** 99ea22a9-3bb8-4c00-aa2a-6cd258e859bd, holds a partial 7/44 upload
  and is abandoned — safe to delete in Claude Design).
