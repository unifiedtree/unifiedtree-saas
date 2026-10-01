# Foundation audit: tokens, dark theme, font, motion, shared components, converter

Phase 0, read-only. Main at `e32a4dc6`. Written 27 Sep 2026.
Area: the design system that every other screen sits on. None of the files in this area is a product screen, so "data points" below means the data slots a shared component shows, and "missing" means what today's repo equivalent cannot show yet. Page-level data (which hook feeds which stat) is in the page audits.

---

## 0. What I read and what I ran

**Read in full:** `README.md`, `CLAUDE_CODE_PROMPT.md`, `DECISIONS.md`; prototype `StyleGuide`, `UtStat`, `UtLive`, `UtQuick`, `UtQIcon`, `UtAniIcon`, `UtArt`, `UtEmpty`, `UtSection`, `UtSections`, `hrms-fx.js`, `ds-base.js`, `hrms-core.js`, the dc runtime `support.js` (parser, expressions, attribute encoding, template compiler, logic base class, component host, helmet, pseudo-class sheet, registry), the header of `image-slot.js`, and where each `Ut*` piece is used across all 46 prototype files.

**Repo:** `packages/design-system/src/{tokens.css,tailwind-preset.cjs,index.ts,tokens/*}`, `apps/platform/{index.html,tailwind.config.js}`, `src/{main.tsx,globals.css,index.css}`, `providers/ThemeProvider.tsx`, `design/module/ModuleKit.tsx`, `shared/components/hr.tsx`, `design/settings/SettingsKit.tsx`, `shared/components/calendar/*`, `design/dc/*` (runtime, DesignFrame, StatTile, SubTabs, SectionState, ApprovalCard, DatePicker, DashCalendar, icons), `design/shell/*`, `packages/ui-kit` (Modal/Drawer), `scripts/dc-to-tsx.mjs`, `scripts/design-build.mjs`, `e2e/**`.

**Scratch experiment (nothing written in the repo; `git status` unchanged):** in
`C:\Users\LENOVO\AppData\Local\Temp\claude\c--REACT-unifiedtree-saas\4c95e1ec-...\scratchpad\dcconv\`
1. Copied 13 new prototype files (`UtStat, UtQuick, UtLive, UtAniIcon, UtSection, UtSections, UtEmpty, UtQIcon, UtArt, PgLeave, EmpHome, StyleGuide, TeamApprovals`) and converted them with the repo's own `apps/platform/scripts/dc-to-tsx.mjs` (it only writes to the out folder you give it).
2. Type-checked the output with the repo's TypeScript and React types.
3. Rendered each converted page in headless Chromium, driven by the prototype's **own** logic class and sample data, next to the prototype running on its own runtime, and compared element count, page height, full text and screenshots, in light and in the design's dark theme.
4. Patched a scratch **copy** of the converter (8 lines) and repeated steps 2 and 3.
5. Captured the full prototype shell offline through its hash deep links (`HrmsPlatform.dc.html#<role>/<module>/<page>/<tab>`).

Screenshots: `shot-PgLeave-proto-1440.png` / `shot-PgLeave-conv-1440.png`, `shot-EmpHome-*`, `shot-EmpHome-proto-1440-dark.png`, `shell-admin-dash.png`, `shell-admin-leave-dark.png`.

---

## 1. Files in this area and where they map

| Prototype file (section) | What it is | Repo today | Ships? |
|---|---|---|---|
| `StyleGuide.dc.html` (Principles, Colour, Font options, type strip, Components, Motion, Page anatomy) | Design-system reference page | No route. Tokens: `packages/design-system/src/tokens.css`, `tailwind-preset.cjs`, `apps/platform/tailwind.config.js`, `src/globals.css`, `index.html` | No (documentation; "nothing static" rule) |
| `UtStat.dc.html` | Stat card for module pages (round icon, sparkline, delta, note, active ring) | `design/dc/StatTile.tsx` via `ModuleKit.StatRow` (29 files); `hr.tsx HrStatCard` (5 files); `shared/components/StatCard.tsx` (7 files) | Yes, as `StatCard` |
| `UtLive.dc.html` (+ `UtAniIcon`) | Accent stat card for Dashboard and self-service Home (`--k` accent, animated icon, sparkline with dot, row/stack layout, flat state) | Dashboard tiles inside generated `design/dc/AdminDashboard.view.tsx`; self-service Home (`ess/EssDashboard.tsx`) uses the plain module-kit `StatRow` tiles (no accent, animated icon or sparkline) | Yes, as `StatCard variant="live"` |
| `UtAniIcon.dc.html` | 8 animated stat icons: users, present, leave, late, half, wfh, none, absent | None | Yes |
| `UtQuick.dc.html` | Quick-action tile with 10 animated line scenes (user, coins, calendar, clock, megaphone, chart, home, download, swap, mail) and a count badge | Dashboard quick actions in `AdminDashboard.view.tsx` (old design) | Yes, as `QuickActionTile` |
| `UtQIcon.dc.html` | Same scenes for the "icon dock" quick-action variant | None | Only if the dock variant is chosen (default is the tile row; `UtQIcon` sits only inside `PgDashboard`'s `qDock` branch) |
| `UtArt.dc.html` | "3D art" floating image slot (`<image-slot>`), used on Payroll run, Reports, My workspace payslip, old dashboard | None | No: no art exists in the handoff and README says "No other imagery" |
| `UtEmpty.dc.html` | Empty state (56px icon tile with ring, title, hint) | `shared/components/EmptyState.tsx` (35 files), `design/dc/SectionState.tsx`, `ModuleKit.State` | Yes, as `EmptyState` |
| `UtSection.dc.html` | Card with header (title, count badge, sub-line, segmented control, action) and 11 body kinds: stats, kv, table, bars, cal, form, steps, chart, ledger (+ net banner), toggles, empty | Pieces spread over `ModuleKit` (Section, Panel, RowList/Row, Facts, Note, State), `hr.tsx TableCard`, `DataTable`, `SettingsKit` (Section, ToggleRow, Switch), `design/dc/ProcessSteps`, `AreaChart` | Yes, as `Card`/`Section` + body parts |
| `UtSections.dc.html` | Lays sections out full width or half (`flex: 1 1 440px`) | None | Yes (small layout helper) |
| `hrms-fx.js` | Motion engine: tilt/spotlight/running border light (`data-fx`), rise, count-up, sparkline draw, ring arc, bar grow, float, pop, ticker; levels full/subtle/off; reduced motion | None (framer-motion inside `HrTabs`, `HrSelect`, `HrDrawer`, ui-kit `Modal`; Tailwind keyframes; a global reduced-motion rule) | Yes, ported |
| `hrms-core.js` → `DARK`, `FONTS`, `applyTheme`, `applyFont`, `applyFx` | Theme switch (inline CSS vars), font picker (8 fonts), motion level | `providers/ThemeProvider.tsx` (dark **locked off**), `index.html` no-flash script, `tokens.css` dark block | Theme: yes. Font picker: no (Plus Jakarta Sans only). Motion level: default only |
| `support.js` | The dc runtime (React UMD from unpkg, template compiler) | `design/dc/dc-runtime.tsx` (render helpers) + `scripts/dc-to-tsx.mjs` + `scripts/design-build.mjs` | No (tooling reference) |
| `ds-base.js` | Loads the design-system bundle (`tokens/tokens.css`, `_ds_bundle.css`, `styles.css`) from a folder not in the handoff | `ds-bundle/` at the repo root (git-ignored `/design-sync` artifact) | No |
| `image-slot.js` | Design-tool image placeholder web component | None | No |

---

## 2. Design tokens (every `--u-*` variable, light and dark)

### 2.1 Colour and effect tokens

"Uses" counts `var(--u-x, fallback)` occurrences across all prototype files. The light value is the fallback in the markup (what actually renders). The dark value is `hrms-core.js → DARK`.

| Token | Role | Light | Dark | Uses | Closest token in `tokens.css` today (light / dark) |
|---|---|---|---|---|---|
| `--u-bg` | page canvas | `#F3F6F4` | `#0A110E` | 4 (+ page wrappers) | `--bg-base` `#f8fafc` / `#090d16`, plus an emerald radial "ground" gradient on `body` |
| `--u-sf` | card surface | `#FFFFFF` | `#101915` | 418 | `--bg-surface` `#ffffff` / `#0f172a` |
| `--u-sf2` | inset tile, table head | `#F7F9F8` | `#0D1512` | 71 | `--bg-inset` `#f8fafc` / `#090d16` |
| `--u-hv` | hover, neutral chip | `#F0F4F2` | `#16211C` | 114 | `--bg-hover` `#f1f5f9` / `#1e293b` |
| `--u-ln` | border | `#E3E9E6` | `#1F2C27` | 361 | `--border-default` `#e2e8f0` / `#334155` |
| `--u-ln2` | hairline | `#EDF1EF` | `#18231F` | 88 | `--border-subtle` `#f1f5f9` / `#1e293b` |
| `--u-ink` | text | `#0E1B16` | `#E6EEEA` | 208 | `--text-primary` `#0f172a` / `#f8fafc` |
| `--u-ink2` | secondary text | `#4A5A54` | `#A7B6B0` | 243 | `--text-secondary` `#475569` / `#cbd5e1` |
| `--u-ink3` | meta text | `#6A7A73` | `#80918A` | 463 | `--text-tertiary` `#64748b` / `#94a3b8` |
| `--u-br` | brand fill | `#0F6E56` | **not in DARK, stays `#0F6E56`** | 40 (+ about 320 raw `#0F6E56`) | `--accent-solid` `#0f6e56` / **`#10b981`** |
| `--u-brt` | brand text and icons | `#0F6E56` | `#5CC4A3` | 250 | `--accent-fg` `#0f6e56` / `#34d399` |
| `--u-brs` | brand soft | `#E8F3EE` | `#10271F` | 141 | `--accent-bg` `#ecfdf5` / `#064e3b` |
| `--u-brs2` | brand soft 2 | `#D2EADF` | `#16362B` | 57 | `--accent-bg-strong` `#a7f3d0` / `#047857` |
| `--u-brl` | brand line | `#BFDFD1` | `#22503F` | 94 | `--accent-border` `#6ee7b7` / `#0f6e56` |
| (none) | brand hover | `#0B5A46` (79 raw uses) | not defined | 79 | `--accent-solid-hover` `#0a5240` |
| `--u-gd` | gold solid | `#C8912E` | `#D9A441` | 42 | `--status-warning-solid` `#f59e0b` |
| `--u-gdt` | gold text | `#8A5A10` | `#E6B865` | 50 | `--status-warning-fg` `#b45309` / `#fbbf24` |
| `--u-gds` | gold soft | `#FAF1E1` | `#2A2113` | 40 | `--status-warning-bg` `#fffbeb` / `#451a03` |
| `--u-rd` | red solid | `#C4453A` | `#E0645A` | 10 | `--status-error-solid` `#ef4444` |
| `--u-rdt` | red text | `#B42318` | `#F18B80` | 40 | `--status-error-fg` `#dc2626` / `#f87171` |
| `--u-rds` | red soft | `#FCEDEB` | `#2C1715` | 27 | `--status-error-bg` `#fef2f2` / `#450a0a` |
| `--u-g2` | mint (charts) | `#5FB39C` | `#3F9C84` | 9 | `--accent-mint` `#10b981` |
| `--u-g3` | pale mint (charts) | `#A9D6C6` | `#2B5C4E` | 8 | none |
| `--u-gy` | grey (charts) | `#C9D2CE` | `#3A4843` | 6 | `--border-strong` `#cbd5e1` (nearest) |
| `--u-ov` | overlay | `rgba(14,27,22,.36)` | `rgba(0,0,0,.55)` | 1 | none (`bg-black/40`, `bg-slate-900/40`) |
| `--u-shc` | card shadow | `0 1px 2px rgba(14,27,22,.05)` | `0 1px 2px rgba(0,0,0,.5)` | 107 | `--shadow-xs` |
| `--u-shh` | hover shadow | `0 20px 40px -22px rgba(15,110,86,.5)` (one use of `0 16px 30px -18px …,.45`) | `0 22px 44px -22px rgba(0,0,0,.85), 0 0 0 1px rgba(92,196,163,.22)` | 8 | none |
| `--u-shp` | popover shadow | `0 24px 60px -20px rgba(14,27,22,.35)` (search dialog: `0 40px 100px -30px …,.55`) | `0 24px 60px -20px rgba(0,0,0,.8)` | 6 | `--shadow-2xl` (different) |
| `--u-font` | font stack | set at runtime to `'Plus Jakarta Sans', system-ui, sans-serif` (markup fallback says `'Geist'`, prototype only) | same | 43 | `--font-sans` `'Plus Jakarta Sans','Inter',…` |
| `--u-railx` | rail hover width | `248px` / `72px` (runtime) | — | 1 | none (shell) |

Runtime-only variables set by the motion engine or inline: `--fx` (216 uses), `--mx`/`--my` (42), `--k` stat accent (28), `--rx`/`--ry` tilt (11), `--fxr` border light (9), `--ang` (9).

### 2.2 Colours the design uses as raw hex (no token, no dark value)

About a third of the design's colour is raw hex. The prototype's own dark theme only swaps `--u-*`, so these stay light in dark mode (verified in `shot-EmpHome-proto-1440-dark.png`: calendar day chips, task icon tiles, due chips, the holiday note, legend dots and progress-bar tracks all stay pale; see §8).

| Group | Light values (README / markup) | Dark value in design | Proposal |
|---|---|---|---|
| Success | soft `#E3F2EA` (23 raw), text `#0B5A46`, solid `#12805F`, `#1F9D6E` | none | soft = `color-mix(in oklab, solid 16%, var(--u-sf))`, text `#5CC4A3` |
| Info (blue) | `#E6F1FA` / `#1D6A9E` / `#2585C7` | none | text `#7CB9E8` |
| Leave (orange) | `#FDEEE4` / `#B4541A` / `#E0661B` | none | text `#F29A5E` |
| Holiday (purple) | `#F1EAFB` / `#6B3DB8` / `#8B4FE0` | none | text `#B794F0` |
| Amber | `#FDF3E3` / `#9A6208` / `#C27A0E` | none | text `#E3AE52` |
| Danger solid | `#D9352B`, `#D92D20` | none | keep |
| Stat accents `--k` | people `#3B6FD9`, present `#12805F`, leave `#E0661B`, late `#D9352B`, half day `#8B4FE0`, WFH `#2585C7`, not marked `#C27A0E`, absent `#D13A6E` | none | keep solids; the tiles already mix them with `var(--u-sf)` so their backgrounds adapt |
| Toast | bg `#0E1B16`, icon `#8FD9BE` | none (1.08:1 against the dark page, i.e. invisible) | dark toast inverted: bg `#E6EEEA`, text `#0E1B16` |
| Rail | gradient `#0F6E56 → #0C5F4A → #0A5240`; "Soon" pill `#E6C47F` on `#0A5240` | stays green (fine) | token `--u-rail-*` |
| Brand scale (StyleGuide) | 800 `#0A5240`, 600 `#16856A`, 400 `#5FB39C`, 200 `#D2EADF`, 50 `#E8F3EE` | — | tokens |
| Misc | selection `#CFE8DD`, border light `#8FD9BE`, focus ring `rgba(15,110,86,.25)` / `0 0 0 3px #E8F3EE` | none | dark focus ring `rgba(92,196,163,.35)` |

Near-duplicate hex between README and markup (use the markup values, they are what renders): warning soft `#FBF1DE` vs `--u-gds #FAF1E1`; gold text `#8A5A12` vs `#8A5A10`; danger soft `#FDECEA` vs `--u-rds #FCEDEB`; danger text `#B4302A` vs `--u-rdt #B42318`.

Status tones (for `StatusPill`): `hrms-data.js TONE` = ok, warn, bad, mint, info, gray, where **info is grey**; `UtSection` draws info as **blue**; README's info is blue. Use blue for info and gray for neutral.

### 2.3 Type

Measured in all prototype files:
- **Weights:** 500 × 1,090, 600 × 89, 400 × 5. Nothing above 600.
- **Sizes (px):** 10, 10.5, 11, 11.5 (70), 12 (312), 12.5 (267), 13 (245), 13.5 (225), 14 (127), 14.5, 15 (69), 15.5, 16 (41), 17, 18, 20, 21, 22, 23, 24, 26, 27, 28 (36), 30, 32, 34, 38, 40, 44.
- **Page title:** 28/34, weight 500, −0.025em (31 of 37 `<h1>`). Greeting 30/38, 500, −0.03em. Card/section title 15/20, 500. Body 13.5–14.5. Meta 12.5 (ink3). Eyebrow 11–11.5 uppercase, .06–.16em. Big figures 26–44 (stat 28/32 weight 500 in `UtStat`, 30/36 weight 600 in `UtLive`).
- **Letter-spacing:** −.025em (39), −.02em (26), −.01em (13), −.03em (11).
- `font-variant-numeric: tabular-nums` on every page wrapper and figure.
- StyleGuide's type-strip labels say "· 600" for page title, section title and stat, but the samples it draws, the README and every page use **500**. Follow 500.

Repo today: `tailwind-preset.cjs` has a 14px-based scale (`2xs` 11 … `7xl` 72) with no weights; `tailwind.config.js` lines 87–89 define `display` 800, `h2` 700, `h3` 700; `body` is 14px (`globals.css`).

### 2.4 Radii, shadows, spacing, z-index

- **Radii used:** 999 (196), 50% (189), 10 (157), 12 (99), 8 (80), 18 (76), 16 (72), 9 (65), 14 (54), 11 (39), 13 (18), 20 (4), 22 (2). Cards 16–20, tiles 13–18, inputs 10–11 (forms in `UtSection` use 11), buttons 8–13, pills 999, menus and dialogs 12, side panels 0.
- **Buttons measured (height/radius):** 38/10 (33), 30/8 (30), 40/11 (20), 40/10 (19), 32/9 (19), 36/10 (18), 28/8 (18), 46/13 (12), 34/9 (10), 42/12 (6), 44/12 (5). Primary: `#0F6E56`, 13.5px/500, `inset 0 1px 0 rgba(255,255,255,.14–.16)` plus a green drop shadow, hover `#0B5A46`.
- **Shadows:** card `--u-shc`; raised card `0 24px 50px -34px rgba(14,27,22,.4)`; popover `--u-shp`; hover `--u-shh`; primary button `0 12px 24px -14px rgba(15,110,86,.9), inset 0 1px 0 rgba(255,255,255,.16)`; active pill `0 10px 20px -12px rgba(15,110,86,.9)`; side panel `-30px 0 70px -30px rgba(14,27,22,.45)`; toast `0 18px 40px -14px rgba(14,27,22,.55)`. Only `shc/shh/shp` have dark values.
- **Page frame:** padding `28px clamp(16px,2.4vw,36px) 56px`; max width 1440 (admin, companies, profiles) or 1320 (self-service). Today `DesignFrame` is 1320 max, `24px clamp(16px,2.5vw,28px) 48px`.
- **Backdrop:** `linear-gradient(270deg, rgba(14,27,22,.38), rgba(14,27,22,.2))` + `backdrop-filter: blur(4px) saturate(.85)` (search uses `blur(3px)`).
- **Z-index in the design:** pages panel 20, header 30, rail 40, popovers 55–56, panel backdrop 70, side panel 71, toast 80. Today: tokens `--z-dropdown 100 … --z-tooltip 700`, but code uses `z-[1000]` (HrDrawer), `1400` (design toasts), `9999` (skip link). Needs one scale.

### 2.5 Motion (`hrms-fx.js` and inline transitions)

- **Easings:** spring `cubic-bezier(.34,1.56,.64,1)` (68 uses: icon pops, scale), standard `cubic-bezier(.2,.8,.2,1)` (29: tilt, rise, panels), in-out `cubic-bezier(.65,0,.35,1)` (12: rotations, tear-off). Repo tokens have `--ease-out: cubic-bezier(0.16,1,0.3,1)` and the same in-out; the design's standard curve is not in the tokens.
- **Durations:** rise 520ms, fade + translateY(10px) (README says 8px), stagger 40ms capped at 14 items; count-up 950ms ease-out-cubic, keeps Indian grouping; bar grow 750ms, delay 120ms + 35ms stagger capped at 16; ring arc 1000ms, delay 150ms + 90ms; sparkline draw 1100ms, replays on hover; pop 260ms (from left, up or down); float 2.8s alternate; ticker every 2.6s; tile hover transitions .35–.6s.
- **Hover engine:** one document-level `pointerover/move/out` listener sets `--fx`, `--mx`, `--my`, `--rx`, `--ry`, `--fxr`, `--ang` on the element under the pointer that has `data-fx="tilt"` (lift 3–4px, spotlight, tilt up to 4.5°, a light running round the border) or `data-fx="spot"` (spotlight only). A `MutationObserver` animates `data-rise/draw/arc/grow/pop/float/count/ticker` elements once each.
- **Levels:** `html[data-ufx="full|subtle|off"]`; subtle drops tilt and border light; off and `prefers-reduced-motion` stop everything except float, which only honours reduced motion.
- **Finding:** count-up never runs in the prototype. The number is rendered inside `span.sc-interp`, and `count()` only animates an element whose only child is a text node. Verified in Chromium: the `[data-count]` value stays "17" from first paint. README asks for count-up, so it has to be a React component.

---

## 3. The repo today

### 3.1 Token and theme files
- `packages/design-system/src/tokens.css` (224 lines): `:root,[data-theme='light']` and `[data-theme='dark']` blocks with slate neutrals and an emerald accent; radius, shadow, motion and z-index scales. Only `apps/platform` consumes it (`main.tsx`, `globals.css`, `vite.config.ts` alias, `tailwind.config.js`); `apps/website` and `apps/employee` do not.
- `tailwind-preset.cjs`: `darkMode: ['class','[data-theme="dark"]']` (line 9); every colour points at a CSS variable.
- `apps/platform/tailwind.config.js`: adds fixed hex colours (`primary #0F6E56`, `bg #FAFAFA`, `success #10B981`, `border #E5E5E5`, a `brand` scale with `500 #059669`), heavy `display/h2/h3` weights, and extra shadows.
- `src/globals.css` (418 lines, imported by `main.tsx`): emerald radial "ground" gradient on `body`, `.ut-card` (with a long warning never to put `backdrop-filter` on it, and `.ut-card.fixed/absolute/sticky/static` overrides), `.ut-input/.ut-select` (with `.ut-input.pl-9…` overrides), `.hr-table`, reduced-motion rule, `.ut-skel` shimmer, hover helpers with raw hex.
- `src/index.css`: **dead**, nothing imports it (checked `.ts/.tsx/.html/.js/.mjs/.json`). It holds a second `--color-*` set and duplicate `.ut-card`/`.ut-input` rules.
- `packages/design-system/src/tokens/index.ts` and `packages/ui-kit/src/tokens/colors.ts`: stale indigo JS tokens, not imported.

### 3.2 The dark-mode lock (`FORCE_LIGHT`)
- `apps/platform/src/providers/ThemeProvider.tsx` line 21: `const FORCE_LIGHT = true`. The comment says dark was disabled for the pilot because about 1,700 hard-coded colours in about 98 files made text invisible in dark. `setTheme` exists, but nothing calls `useTheme()` anywhere, so there is no toggle.
- `apps/platform/index.html` lines 25–35: a no-flash script sets `data-theme` from `localStorage['ut.theme']` or, if unset, **the OS preference**, before React runs. It ignores `FORCE_LIGHT`, so an OS-dark user gets `data-theme="dark"` for a moment until `ThemeProvider` resets it to light. It must change together with the provider.
- `shared/components/calendar/calendar.css` line 3: "The app is light-only (FORCE_LIGHT), so there is no dark variant."

### 3.3 Font loading today
- `index.html` line 22: Google Fonts **Inter 400–800**, **Plus Jakarta Sans 400–800**, JetBrains Mono 400/500. Line 24: the Tabler Icons webfont from jsdelivr, which **nothing uses** (the only "ti ti-" is the comment above it).
- `body` uses `var(--font-sans)` = Plus Jakarta Sans. But the module kit pins Inter inline: `ModuleKit.tsx` line 17 `FONT = 'Inter,-apple-system,sans-serif'`, `SettingsKit.tsx` line 15, `DesignFrame.tsx` line 22, `ShellChrome.tsx`, and 43 files under `design/dc` (mostly generated views). **204 explicit Inter stacks in 58 files.** Most module pages therefore render in Inter today.
- Heavy weights: `font-bold` 111, `font-extrabold` 7, `font-black` 11, inline `fontWeight` 700/800/900 453, CSS `font-weight` 700/800 49, in 128 files. `ModuleKit` `Section` h2 is 21px/700, `SubHeading` 16px/800, `Panel` title 700; `HrStatCard` value is `font-black`; `HrPageHeader` title `font-bold`.
- The design's monospace is `ui-monospace, Menlo, monospace` (registration numbers, next employee ID, branch codes), not JetBrains Mono.

### 3.4 Hard-coded colour debt (what breaks when dark is switched on)

| Folder | Hex literals | Fixed Tailwind palette classes | rgba() |
|---|---|---|---|
| `design/dc` (generated views + logic) | 2,412 | 0 | 148 |
| `modules/hrms` | 882 | 337 | 16 |
| `pages` | 284 | 189 | 36 |
| `shared` | 221 | 217 | 20 |
| `design/master` | 140 | 0 | 12 |
| `design/settings`, `design/module`, `design/shell` | 79, 41, 37 | 0 | 38 |
| `layouts`, `core` | 19, 18 | 10, 46 | 7 |

Total: about 4,100 hex literals, 800 palette classes (`bg-white` 130, slate/gray 206, emerald/green 119, …) and 280 `rgba()` in about 250 files. 79 `dark:` variants exist (mostly `hr.tsx`) and assume the old Tailwind palettes. 1,401 usages already go through token classes (`bg-bg-surface`, `text-text-primary`, …) and would switch correctly.

---

## 4. Contrast check (WCAG, README requires 4.5:1 for text)

| Pair | Ratio | Result |
|---|---|---|
| ink3 `#6A7A73` on white | 4.52 | pass (barely) |
| ink3 on page bg `#F3F6F4` / sf2 `#F7F9F8` / hover `#F0F4F2` | 4.16 / 4.28 / 4.08 | **fail**. ink3 is the most used text colour (463) and often sits on grey tiles |
| leave text `#B4541A` on `#FDEEE4` | 4.39 | **fail** |
| amber `#9A6208` on `#FDF3E3` | 4.63 | pass |
| ink2, brand text on brand soft, white on brand, gold, red, info, holiday pairs | 5.08–7.29 | pass |
| rail group label `rgba(255,255,255,.56)` on the rail | ≈3.4 | **fail** (shell) |
| DARK ink/ink2/ink3/brand text on surface | 15.2 / 8.5 / 5.4 / 8.4 | pass |
| DARK raw `#0F6E56` used as text ("Apply", "Open" links; 63 raw `color:#0F6E56`) on `#101915` | 2.89 | **fail**: must use `var(--u-brt)` |
| DARK toast `#0E1B16` against page `#0A110E` | 1.08 | **invisible** |

Nudges that keep the look: ink3 → `#60706A` (4.59–5.22 on every light surface), leave text → `#A94E17` (4.89).

---

## 5. Shared components: today and what to build

Importer counts are files with a one-line import (a floor, multi-line imports are not counted).

| README component | Closest today (importers) | Decision | Notes from the design |
|---|---|---|---|
| **PageHeader** | `hr.tsx HrPageHeader` (10), `ModulePage` header (40) | **Extend** `HrPageHeader`/`ModulePage` | Context line 13px/500 ink3 → h1 28/34/500 −.025em → summary 14.5/21 ink2; actions right (38px buttons); greeting variant 30/38 (name from `greetingName()`, not its own logic); date chip. No card behind it (today it is a white card with glows). |
| **PillTabs** | `hr.tsx HrTabs` (4, role=tab), `design/dc/SubTabs` via `ModuleKit.Views` (17), shell underline sub-nav | **New**, replaces `HrTabs`/`Views` look | 40px, radius 999, 0 16px, 13.5px; active solid brand + active-pill shadow; idle white, 1px line, ink2; hover brand-line border, brand-soft fill, −1px lift; horizontal scroll with right fade mask (`mask-image: linear-gradient(90deg,#000 calc(100% - 40px),transparent)`). **Keep `role="tablist"`/`role="tab"`/`aria-selected`**: the design uses `aria-current` buttons, but 21 test files and screen readers rely on tab roles. |
| **SearchPill** | `TopBarSearch`, `CommandPalette`, `GlobalSearch` | **Extend** (shell audit owns behaviour) | Green round icon, rotating hint (ticker), ⌘ K keys. |
| **StatCard** | `StatTile` via `StatRow` (29), `HrStatCard` (5), `StatCard` (7) | **New** `StatCard` with variants `stat` (UtStat) and `live` (UtLive); `StatRow` keeps its API and renders it | Missing today: sparkline, delta with trend arrow and mood colour, note, active (selected filter) ring, tone set brand/gold/red/gray, `--k` accent, 8 animated icons, flat-series dashed line, row/stack layouts, count-up, tilt/spotlight. |
| **QuickActionTile** | quick actions inside generated `AdminDashboard.view.tsx` | **New** | 10 animated line scenes, gold count badge, arrow that slides in on hover, 138px tile. "Customise" needs backend (dependency, §12). |
| **Card / Section** | `ModuleKit` `Section` (icon tile + 21px/700 heading), `Panel` (25), `.ut-card`, `SettingsSection` (8) | **New** `Card` + **extend** `Panel` | Radius 18, 1px line, `--u-shc`; header: 15px/500 title, count badge (brand soft), 12.5px sub, segmented control, outline action button. Body parts from `UtSection`: stats tiles, key/value grid, table, bars, month grid with tags, form, horizontal steps, column chart with legend, ledger with totals, toggles, dashed empty box. Keep the `.ut-card` class on it (tests locate it). |
| **ListRow** | `ModuleKit` `Row`/`RowList` (19/18) | **Extend** | 32px soft avatar, name + sub, pills, trailing actions (primary soft `#E8F3EE`→filled on hover, secondary outlined). |
| **StatusPill** | `hr.tsx HrStatusPill` (118) | **Extend**, keep tone names | 22–24px, 12px/500, optional 6px dot. Map: ok/green → success; warn/late → gold; red → danger; info/blue → info (blue); purple → holiday; orange → leave; teal → brand soft 2 (WFH); pink → absent accent; gray → neutral. |
| **ApprovalRow** | `ApprovalCard` via `ApprovalList` (2), `DecisionCard` (4) | **New** (card look kept for detail views) | Inline Approve/Reject; decided state becomes "Approved · who · what" with an inline **Undo** button (TeamApprovals). Needs a backend undo contract (dependency, §12). |
| **SegmentedControl** | none shared (21 files with hand-rolled `aria-pressed`/radiogroup toggles) | **New** | Track `--u-hv`, radius 10, 3px padding; items 26px, radius 7, 12px/500; active white + small shadow. |
| **FilterPills** | `hr.tsx FilterBar` (native selects) | **New** (FilterBar stays for dense filters) | Pills with counts (e.g. "Pending 9", "All 12"). |
| **MonthCalendar** | `DashCalendar`, `AttCalendar` (generated), `UtSection` cal | **New, built on `shared/components/calendar`** (client decision) | Day states + legend (present, late, home, holiday, leave, to fix). `DayGrid` has no custom-cell hook, so add one to `parts.tsx` or reuse `dateMath.monthCells` + `CalChip/CalArrow/MonthGrid/YearGrid` as DashCalendar does. Re-token `calendar.css` (`#059669` → brand, add dark). |
| **Meter / ProgressBar** | `SeatsTile`, `SeatsUsageTile` (role=progressbar) | **New** | 10px track `--u-hv`, radius 5, fill brand/gold/red, grows on X. |
| **Ring** | inline SVG in dashboard/analytics/face enrol views | **New** | Geofence ring (radius scales, dashed amber when unset) and progress ring (arc draw 1000ms). |
| **Avatar** | `hr.tsx HrAvatar` (38): 36px rounded square, white on greens | **Extend** | Design: circle, 32–36px, `--u-brs2` background with brand initials 11.5px/600; online dot variant (More panel). |
| **EmptyState** | `EmptyState` (35), `SectionState` | **Extend** | 56px white tile, 1px line, soft brand ring; title 15px/500; hint 13px ink3; keep the optional next action (README). |
| **Skeleton** | `SkeletonBlock` (30), `PageSkeleton`, `.ut-skel` (slate gradient) | **Extend** | Re-token the shimmer for both themes. |
| **Toast** | four systems: sonner `toast.*` (124 calls, 19 files, top-right), `useDesignToast` (25 files), `useSettingsToast` (7), `useReportToast` (4), plus toasts inside generated views | **New single Toast** on sonner as engine | Bottom centre, 360px, radius 12, dark, check icon, 2.6s for success; errors stay longer (today 7–8s; keep that behaviour). Dark theme needs its own colours (§2.2). |
| **Popover / Menu** | none shared (5 hand-rolled `role="menu"`) | **New** | Radius 12, 1px line, `--u-shp`, pop-in 260ms, Esc closes. |
| **Dropdown with search** | `hr.tsx HrSelect` (23, no search) | **New** (HrSelect stays) | Company switcher: 66px trigger, search input with count, rich rows, tick, footer action. |
| **SidePanel** | `hr.tsx HrDrawer` (44 files, 65 uses), ui-kit `Drawer` (6), generated `BranchDrawer`, `CompanyDrawer`, `PayslipDrawer`, 18 hand-rolled fixed overlays | **Extend `HrDrawer`** | Square edges, 1px left border, `min(680px,100vw)`, gradient-blur backdrop as a **sibling** (never an ancestor, see the `.ut-card` containing-block warning), stepper variant (196px step list, done/current/todo), sticky footer, round close button. Keep `aria-label="Close panel"` and the focus trap (the design markup has neither `aria-modal` nor a trap). |
| **Dialog** | ui-kit `Modal` (Radix, 21 files/34 uses), `ConfirmDialog` (11), `SettingsLeaveModal` | **Extend** | Radius 12, gradient-blur backdrop. Keep the framer-motion `x/y` centring (see the comment in `Overlay.tsx`). 20 `window.confirm/alert` calls remain in HRMS files (Phase 7). |
| **FormField** | ui-kit `Field/Input`, `.ut-input/.ut-select`, `SettingsInput`, `SettingsSwitch`, `DateField`/`TimePicker` | **Extend** | Label 12.5px/500 ink2; 40px inputs, radius 11, focus `border #0F6E56` + `0 0 0 3px --u-brs`; switch 38×22 (design) vs 44×24 in SettingsKit; slider (50–500 m); inline validation. Keep `role="switch"`. |
| (also) **Button** | `hr.tsx HrButton` (138) | **Extend** | Sizes 28/30/32/36/38/40/44 with radius 8–13, 13.5px/500, primary shadow. |
| (also) **Sparkline, CountUp, motion hooks** | none | **New** | See §10. |
| (also) **Tooltip** | global `data-tip` engine in `ShellChrome` (140 uses) | **Keep, re-token** | "Next" disabled with a tooltip in side panels. |

Design-only pieces not in the README list: `LiveStatCard` icons (`UtAniIcon`), quick-action scenes (`UtQuick`), the half/full section layout (`UtSections`). Not shipped: `UtArt`, `image-slot`, the font picker, "Viewing as".

---

## 6. Converter feasibility (tested)

### 6.1 How today's pipeline works
`scripts/design-build.mjs` unpacks the **bundled** Claude Design exports in `docs/Designs/*.html` (manifest + base64 resources), applies about 500 lines of string patches (`DERIVED`, `LITERALS`, `PATCH`, `POST`: permission wraps, sample text → bindings, extra slots), then runs `scripts/dc-to-tsx.mjs` per component to write `src/design/dc/<Name>.view.tsx` (+ `.view.css`). Logic classes (`<Name>.tsx`, extending `DCLogic` from `dc-runtime.tsx`) are hand-written; containers under `modules/hrms/**` pass real data in through `px` props.

The new handoff is a **folder of raw `.dc.html` files**, not a bundle, so `design-build.mjs` cannot read it as is. `dc-to-tsx.mjs` itself reads raw files fine.

### 6.2 What works (verified)
All 13 files converted without a warning. Driven by the prototype's own logic class and sample data:

| Page | Elements (prototype / converted) | Height px | Text |
|---|---|---|---|
| `PgLeave` 1440px | 515 / 515 | 1337 / 1337 | identical |
| `EmpHome` 1440px | 608 / 608 | 1527 / 1527 | identical |
| `EmpHome` 390px (mobile) | 608 / 608 | 3580 / 3580 | identical |
| `TeamApprovals` 1440px | 253 / 253 | 1946 / 1946 | identical |
| `StyleGuide` 1440px | 380 / 380 | 2993 / 2948 (the prototype page loads 7 sample webfonts, the harness does not) | identical |

Screenshots are visually identical, in light and in the design's dark theme. Supported and working: `sc-if`, `sc-for` (with `$index`), `dc-import` (kebab props → camelCase, `on-*` handlers, position-only host style exactly like the runtime), `{{ }}` in text and whole-attribute bindings, event attributes (`onClick`, `onChange`, `onInput`, `onKeyDown`, `onMouseEnter`), `style-hover` / `style-focus` (become generated classes with `!important`, as the runtime does), `ref`, `defaultValue`, SVG markup, and `data-fx/rise/draw/arc/grow` attributes, which the motion engine picks up unchanged.

The new files use no expression operators inside `{{ }}`, no mixed text-plus-binding attributes, no `sc-else` and **no `x-import`** (they use `dc-import`, 145 times). The converter's limits in those areas are therefore not hit.

### 6.3 What breaks (verified)
1. **`tabindex` / hyphenated SVG attributes.** The new files use HTML attribute case (`tabindex` 12, `stroke-width` 356, `stroke-linecap` 298, `stroke-linejoin` 292, `stroke-dasharray` 35, `stroke-dashoffset` 10, `fill-opacity` 5, `stroke-opacity` 4, `crossorigin` 1, `vector-effect` 1). The old exports used React case. Result: `tsc` fails (TS2322 `tabindex` in `UtStat`, `UtQuick`, `UtLive` ×2), and React logs an "Invalid DOM property" console error per attribute name in dev.
2. **CSS custom properties in static style literals** (`--k` accents in `EmpHome`): 8 × TS2353. The app's `build` runs `tsc`, so this stops the build.
3. **Helmet `<style>` blocks** are copied verbatim into `.view.css` as global CSS: `StyleGuide` and `HrmsPlatform` would restyle `body`, `a` and `::selection` app-wide.
4. **`<image-slot>`** (`UtArt`): TS2339, and no asset exists.
5. **Raw hex** stays raw (status soft colours, `#fff` text, `#0E1B16` toast), so dark mode needs a token pass on the output.
6. **Accessibility is copied as designed:** tiles are `div role="button" tabindex="0"` with a click handler and no Enter/Space handler; side panels have `role="dialog"` without `aria-modal` or a focus trap; pill tabs have no tab roles.
7. **Maintenance:** views are large inline-style blobs (`EmpHome` 704 lines, `UtSection` 718, `UtStat` repeats its markup once per tone). `design-build.mjs` already needs about 500 lines of `replaceOnce` string patches for the old designs.
8. **Tooling:** `e2e/recovery/capture-prototype.mjs` only reads the old bundled export (route in `localStorage`). The new prototype needs hash deep links, React UMD injected (the runtime otherwise loads it from unpkg) and a local static server; the scratch `shell.cjs`/`shoot.cjs` do exactly that and render offline with no page errors.

### 6.4 The fixes are small (verified on a scratch copy)
A scratch copy of `dc-to-tsx.mjs` with 8 added or changed lines (map `tabindex` → `tabIndex` and similar, camelCase hyphenated attributes on non-custom elements, cast style literals that contain `--*` to `CSSProperties`, skip helmet styles unless asked) produced output that **type-checks with zero errors** for all 12 files, has zero hyphenated SVG attributes left, leaks no `body` CSS, renders with **zero console errors**, and still matches the prototype exactly (numbers above). Still to add if the pipeline is used for new files: a folder source mode in `design-build.mjs`, an Enter/Space handler wherever `role="button"` has a click handler, and optionally typed props from each file's `data-props` `tsType`.

### 6.5 What the converter cannot do
It produces markup only. Everything that makes a page real lives in logic you write: hooks, permission gating, loading/empty/error states, controlled forms with validation (`UtSection` forms are uncontrolled `defaultValue` inputs), optimistic updates and undo. The prototype's logic classes are written against sample shapes (`window.UTD.leaves`, `window.UTE…`), so none of them can be reused.

**Six admin prototypes are almost pure data.** `PgTime`, `PgPay`, `PgSetup`, `PgTalent`, `PgGrow` and `PgAdmin` have 2–4 KB of markup (a header plus `UtSections`) and 17–56 KB of sample section definitions. Their look is entirely `UtSection`. Across them: table 114 sections, form 78, stats 48, kv 34, toggles 13, bars 11, ledger 5, empty 5, chart 4, steps 4, cal 3. Converting their markup gains nothing; a React `Section` family fed by real hooks is the build.

---

## 7. Recommended build approach: a mix

1. **Hand-build, on tokens, typed** (`apps/platform/src/design/…`, extending `ModuleKit` and `hr.tsx` so existing importers upgrade in place): every interactive or structural piece: PageHeader, PillTabs, SearchPill, SegmentedControl, FilterPills, Popover/Menu, Dropdown with search, SidePanel (+ stepper), Dialog, Toast, FormField, Button, StatusPill, Avatar, ListRow, ApprovalRow (+ undo), Meter, Ring, Skeleton, EmptyState, MonthCalendar (on the shared calendar), Card/Section. Reason: they need focus management, keyboard support, portals, ARIA, controlled state and both themes, none of which the design markup provides.
2. **Convert once, then own (no regeneration):** the purely visual leaves with intricate exact styling: `UtStat`, `UtLive` + `UtAniIcon`, `UtQuick` (and `UtQIcon` only if the dock is chosen), `UtEmpty`, and the `UtSection` body renderers. Run the patched converter once as a starting point, then refactor by hand into typed components, replace raw hex with tokens, and add keyboard handling. This keeps pixel fidelity cheaply without a patch-and-regenerate loop.
3. **Pages:** compose by hand from 1 and 2, reading layout values from the prototype. A page's converted markup may be used as a one-time scaffold, but only if it ends up using the shared components and tokens, never inline copies of cards, pills or buttons. Keep `design-build.mjs` and the existing generated views working until each page is migrated, and don't hand-edit a `.view.tsx` that the build still regenerates.
4. **Visual QA tooling:** add a capture script for the new prototype (hash deep links, React UMD injected, local static server) so every role, page and tab has an offline reference screenshot to compare with `capture-app.mjs`. The scratch versions (`shoot.cjs`, `shell.cjs`, `serve.mjs`) show it works.

---

## 8. How dark mode should work

1. **One token source, two themes.** In `packages/design-system/src/tokens.css`, define the design's `--u-*` names under `:root,[data-theme='light']` (light values from §2.1) and `[data-theme='dark']` (the `DARK` map), plus the missing ones (§2.2: success, info, leave, holiday, amber, brand hover, rail, toast, focus ring, overlay). Then **re-point the existing semantic tokens** at them (`--bg-surface: var(--u-sf)`, `--text-primary: var(--u-ink)`, `--border-default: var(--u-ln)`, `--accent-fg: var(--u-brt)`, `--accent-solid: var(--u-br)`, …). The 1,401 existing token-class usages then pick up the new palette and dark mode with no code change, and converted markup that says `var(--u-sf,#fff)` works verbatim (the fallback is only used if a token is missing).
2. **Brand fills stay `#0F6E56` in dark** (the design leaves `--u-br` out of `DARK`); today's dark `--accent-solid` is mint `#10b981`. Follow the design.
3. **Theme switch:** set `FORCE_LIGHT = false` only when the pages are ready (see risks). Theme is `light | dark`, stored in `localStorage['ut.theme']` (existing key), applied as `data-theme` on `<html>` with `color-scheme` so native controls and scrollbars follow. Change the `index.html` no-flash script in the same commit so it resolves exactly like the provider. The Light/Dark control lives in the More panel (shell audit).
4. **No raw colours in shared components.** Every shared component uses tokens. Soft tints use `color-mix(in oklab, <solid> N%, var(--u-sf))`, as `UtLive` already does, so they adapt to the theme by themselves.
5. **Legacy debt:** about 4,100 hex, 800 palette classes and 280 `rgba()` (§3.4) are removed page by page as each page moves onto the shared kit (which the redesign does anyway). Add a check to the build (a lint rule or a script that counts raw hex in `modules/hrms` and `design`) so the number only goes down.
6. **Special cases:** charts (recharts) need theme-aware colours: read tokens on theme change or pass them via `style`. Leaflet street tiles stay light. The `.ut-skel` shimmer, `::selection`, scrollbars, focus rings, the data-tip tooltip and the toast get dark values. Print stays light (already in `globals.css`).
7. **Scope:** the signed-in app follows the toggle. Recommendation: pre-auth, white-labelled pages (sign-in, forgot/reset password, accept invite, pending approval) stay light. The platform app also has non-HRMS routes (`/crm`, `/projects`, `/inventory`, `/accounting`, … mostly "coming soon" screens); they must at least use tokens so they don't break in dark.
8. **Default:** Light, like today. The design's control has only Light and Dark (no System). See question 1.

---

## 9. Font plan (Plus Jakarta Sans, 400/500/600, whole app)

1. `index.html`: load only `Plus+Jakarta+Sans:wght@400;500;600` with `display=swap` and keep the preconnects. Drop Inter, drop JetBrains Mono (the design's mono is the system `ui-monospace, Menlo, monospace`), drop the unused Tabler Icons stylesheet (it blocks rendering).
2. Tokens: `--font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`; `--u-font` = the same; `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
3. Replace the 204 inline Inter stacks (58 files; `ModuleKit` `FONT`, `SettingsKit` `FONT`, `DesignFrame`, `ShellChrome`, the generated views) with `inherit` or `var(--font-sans)` **in the same change** that removes Inter, or those texts fall back to the system font.
4. Weights: with only 400–600 loaded, a browser renders 700/800/900 requests with the 600 face; add `font-synthesis-weight: none` globally so nothing is faked bolder. Clamp Tailwind's `fontWeight` `bold/extrabold/black` to 600 in the preset and drop the 700/800 weights from `tailwind.config.js` `display/h2/h3`. Then clean inline `fontWeight: 700/800/900` (453) as each page is rebuilt.
5. `font-variant-numeric: tabular-nums` on every figure (the page wrapper already does it in the design).

---

## 10. Motion plan

1. Port `hrms-fx.js` as one module (for example `src/design/fx.ts`), installed once at app start. It is framework-agnostic and safe with React: it only sets CSS variables and runs Web Animations on elements that carry `data-fx/rise/draw/arc/grow/pop/float`. Verified running on the converted React DOM.
2. Replace `data-count` with a React `<CountUp>` (950ms, ease-out-cubic, keeps `en-IN` grouping and prefixes such as ₹). The DOM version cannot work on React-rendered numbers, and does not run in the prototype either.
3. Replace `data-ticker` (search hint) with a small React component.
4. Level: `html[data-ufx]` defaults to `full`; `prefers-reduced-motion` turns everything off (the engine already checks it, and `globals.css` already zeroes CSS transitions). No level setting in the UI unless asked (the design only has it in its review "Tweaks" panel).
5. Tokens: `--ease-standard: cubic-bezier(.2,.8,.2,1)`, `--ease-spring: cubic-bezier(.34,1.56,.64,1)`, `--ease-in-out: cubic-bezier(.65,0,.35,1)`, durations for rise 520, count 950, grow 750, ring 1000, draw 1100, pop 260; add `/* @kind other */` after the motion and z-index tokens (per the design-sync step).
6. Keep framer-motion where it is (HrDrawer, ui-kit Modal), switching its easing to the standard curve.

---

## 11. Permissions

No foundation piece is gated itself. Callers decide what to render with the existing mechanisms, and the components take already-filtered lists:
- `@unifiedtree/sdk` `usePermission(code)`, `useAnyPermission(codes)`, `useAllPermissions(codes)`, `<Can>`, `<CanAny>` (`packages/sdk/src/permissions/usePermission.tsx`; `*` grants satisfy every code), and `core/permissions/PermissionGate.tsx`.
- Navigation and search: `shared/navigation/pageRegistry.ts` (`access` clauses), `access.ts`, `useAccess.ts`, and `PlatformShell` `visibleWithAnyPermission`.
- Server: `@PreAuthorize` stays the source of truth.
- The theme control needs no permission (personal preference). A quick-action tile or stat card must only be rendered when the viewer can open where it leads; that check belongs to the page (for example wrap the tile in `CanAny`).

---

## 12. Gaps and backend work

| Gap | Work | DB change | Size |
|---|---|---|---|
| Dark theme can't be turned on | Tokens in both themes (§8), provider + no-flash script, More-panel toggle (shell) | No | M |
| Design gives no dark values for success/info/leave/holiday/amber, stat accents, toast, focus ring | Derive (§2.2), check contrast, get sign-off | No | S |
| Token set doesn't match the design | Add `--u-*` + radius/shadow/motion/z/layout tokens, re-point semantic tokens and the Tailwind preset | No | M |
| Font: Inter pinned in 58 files, weights up to 900 | §9 | No | M |
| Hard-coded colour debt blocks dark mode | §3.4, retired page by page + a build-time counter | No | L |
| Shared component set (22 README pieces + design leaves) | §5, §7 | No | L |
| Motion engine, CountUp, sparkline/ring/bar animation | §10 | No | M |
| Four toast systems | One Toast on sonner, `useDesignToast`/`useSettingsToast`/`useReportToast` delegate to it | No | M |
| Pop-ups everywhere (Phase 7): HrDrawer 65 uses, Modal 34, Drawer 6, 18 hand-rolled overlays, 20 `window.confirm/alert` in HRMS | Restyle HrDrawer/Modal once, move the rest | No | L |
| Converter can't read the new handoff; output fails `tsc` | §6.4 fixes, folder source mode | No | S |
| No offline capture of the new prototype | New capture script (§7.4) | No | S |
| Theme should follow the person across devices (optional; not needed if per-device is fine) | Add an **unmapped** `ui_preferences JSONB` column to `auth.user_credentials`. That table is JPA-mapped by `UserCredential` (`platform/hrms-auth`, `ddl-auto: validate`), so the entity must not map it; read and write it with JdbcTemplate in `UserProfileController` (`GET/PUT /v1/users/me`), exactly as V114 did for `notification_preferences`. Fall back to `localStorage` when the column is missing (production applies migrations by hand). No new permission. | New column (only if wanted) | M |
| Dependency (Dashboard/Home audits): "Customise" quick actions | Per-user order/visibility of tiles: new table (for example `user_quick_actions`), `GET/PUT /v1/me/quick-actions`, authenticated, tenant scoped, JdbcTemplate | New table | M |
| Dependency (Team/Approvals audit): approval Undo | `ApprovalRow` needs `onUndo` + `undoUntil`; backend needs a revert-decision endpoint per request type within a window | Likely (decision audit trail) | L |

---

## 13. Conflicts with existing behaviour, earlier decisions or the design itself

1. `saved-designs.md` says the current defaults are "Header C, Quick actions C"; README and `HrmsPlatform`'s own prop defaults are A (outlined pills) and A (tile row). Follow README.
2. StyleGuide labels say weight 600 for titles and stats; the samples, README and pages use 500. Follow 500.
3. README and markup disagree on a few hex values (§2.2). Use the markup's token values.
4. "Info" tone is grey in `hrms-data.js` and blue in `UtSection`/README. Use blue for info and gray for neutral.
5. README: "No dark-green filled content blocks in pages", yet `UtSection`'s ledger **net pay** banner is `linear-gradient(135deg,#0F6E56,#0A5240)`. Flag to the payroll audit; suggest a brand-soft banner.
6. `UtArt` "3D art that floats" (StyleGuide) vs README "No other imagery"; no art exists. Drop it (question 3).
7. Pill tabs in the design use `aria-current` buttons; today's tabs use `role="tab"` and 21 test files query tab roles. Keep tab roles.
8. The design's side panel lacks `aria-modal` and focus trap; tiles are clickable divs without keyboard support; count-up doesn't actually run. Build the accessible, working version with the same look.
9. The design's own dark theme is incomplete (§2.2, §4): raw-hex surfaces stay light, raw `#0F6E56` links fail contrast, the toast disappears.
10. ink3 and leave-orange text fail the README's own 4.5:1 rule on some surfaces. Nudge them (§4).
11. Today's dark accent solid is mint `#10b981`; the design keeps `#0F6E56`. Follow the design.
12. **Calendar = `src/shared/components/calendar` (client decision).** MonthCalendar and every date field must use it. It is light-only and uses `#059669`; re-token it, don't replace it.
13. **Settings stay in their own sections (client decision).** Restyling `SettingsKit` must keep the "On this page" list, `#st-<section>` anchors (including the "keep in view while sections above load" behaviour) and the unsaved-changes bar.
14. **Greeting uses `greetingName()` (client decision).** PageHeader's greeting takes the name from it; no second rule.
15. My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN, companies restore/Inactive view, and the `railLit.ts` rule are shell/page concerns. Nothing in the foundation changes them, but SidePanel and Dropdown must support the Inactive list and restore dialogs `CompaniesPage` already has.
16. `body` today has an emerald radial "ground" gradient; the design's canvas is a flat `#F3F6F4`.
17. `DesignFrame` (1320 max, smaller padding, Inter) vs the design frame (1440 admin / 1320 self-service, `28px clamp(16px,2.4vw,36px) 56px`).
18. In both the runtime and the converter, a `dc-import`'s `style` only passes position and size; `flex`, `min-height` and `display` on an import are silently dropped. FYI for anyone scaffolding pages from converted markup.
19. Toast: design says bottom centre, 2.6s; sonner shows top right with rich colours; design toasts in the app keep errors 7–8s. Use the design spec for success and keep longer error display (existing behaviour).

---

## 14. Risks, and tests that assert today's markup

**Tests at risk** (e2e):
- `.ut-card` / `.ut-card-sm` locators: `live-att-analytics-calendar.mjs` (line 85), `live-money-modals.mjs` (89), `live-w3-r1.mjs` (183), `live-w3-r2.mjs` (189, 204, 316), `live-w3-r3.mjs` (281). Keep the class names on the new Card and SidePanel, or update these tests.
- `getByRole('tab')`: specs `02-employees`, `03-organization`, `04-leave`, `09-workspace`, `role-matrix`; recovery `capture-design-screens`, `live-att-analytics-calendar`, `live-dead-entrypoints`, `live-design-attendance`, `live-design-payroll`, `live-design-workspace`, `live-directory-search`, `live-exit-center`, `live-money-modals`, `live-overtime-browser`, `live-payroll-access`, `live-settings-restored`, `live-shift-request-dates`, `live-shift-requests`, `live-w3-analytics`, `live-w3-greeting-myatt`.
- "Close panel" (HrDrawer close label): `expense-batches-live`, `live-advance-admin`, `live-fnf-admin`, `live-w3-r1`, `performance-admin-live`.
- "Try again" (error retry label; the design says "Retry"): `live-fnf-admin`, `live-modules`, `live-payroll-access`.
- `getByRole('switch')`: `live-design-access`, `live-design-master`, `live-design-payroll`, `live-design-settings`, `live-payroll-access`, specs `02-payroll-settings`, `08-payroll`.
- `getByRole('alert')`: `live-fnf-admin`, `live-inspector-browser`, `live-modules`, `live-payroll-access`, `live-w3-faceenroll`, `live-w3-r4`.
- `getByRole('dialog')`: 127 uses in 42 files (most in `live-w3-r1` 15, `performance-admin-live` 13, `live-w3-r3` 9, `live-w3-faceenroll` 9, `live-w3-r4` 7, `live-compliance-modals` 6). New SidePanel and Dialog must keep `role="dialog"` and their accessible names.
- `live-modules.mjs` line 41 `toHaveCSS('opacity','1')`; `live-rail-highlight.mjs` finds `nav[aria-label="Primary"]` (shell); `live-settings-restored.mjs` checks settings sections.
- Tooling: `capture-prototype.mjs` cannot read the new handoff.

Unit tests (`vitest`, 12 files) cover logic only (`dateMath`, `railLit`, `pageRegistry`, `greetingName`, …); none asserts markup.

**Other risks:**
1. Turning on the toggle before every page is migrated shows light-on-light pages (the reason `FORCE_LIGHT` exists). Keep the lock, or hide the control, until each HRMS page has passed a dark QA pass.
2. Re-pointing tokens (slate → green-grey) and clamping weights changes every page at once, including non-HRMS routes. That is intended, but needs a before/after screenshot sweep.
3. `backdrop-filter` makes an element the containing block for fixed descendants (this broke 14 drawers on 2026-08-23). The panel backdrop must be a sibling of the panel, and never go on `.ut-card`.
4. `.ut-card.fixed` and `.ut-input.pl-*` overrides in `globals.css` fix real bugs; a new Card or Input must keep them or reproduce them.
5. `color-mix(in oklab, …)` needs Chrome 111+, Safari 16.2+, Firefox 113+. Older phone browsers lose those tints; give self-service pages a plain fallback.
6. The hover engine uses document-wide pointer listeners and a MutationObserver. Limit `data-rise` to top-level cards (not table rows) and respect reduced motion.
7. `tsc` blocks the build: converted new files fail it until the converter fixes land (§6.3).
8. Removing Inter from the font link while inline Inter pins remain drops those texts to the system font.
9. The index.html no-flash script and `ThemeProvider` must change together, or dark flashes on load.
10. The 79 existing Tailwind `dark:` variants activate as soon as dark is on and use old palettes; review them.
11. Regenerating old views with `design-build.mjs` overwrites any hand edits in `.view.tsx`.

---

## 15. Open questions (real ones only)

1. **Default theme:** start everyone on Light (as today) and let them switch in the More panel, or follow each device's dark setting on the first visit? The design's control has only Light and Dark.
2. **Dark colours the design doesn't give:** success, info, leave, holiday, amber, the 8 stat accents, the toast and the focus ring. OK to use the values proposed in §2.2 (checked for contrast) and show screenshots, or will the designer supply them?
3. **3D art slots** on the Payroll run header, Reports and the My workspace payslip card: drop them (README says no other imagery and no art files exist), or should something replace them?
