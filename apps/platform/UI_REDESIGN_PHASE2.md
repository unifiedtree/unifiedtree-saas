# Phase 2 UI Redesign — Shared System & Shell

This document summarises the architectural changes implemented during Phase 2 of the UI
redesign. It is the reference for developers building new features or modifying the shell.

> ### ⚠️ Correction — 2026-09-21
>
> An earlier revision of this document described a shell architecture built from
> `Sidebar.tsx`, `Header.tsx`, `TopModuleNav.tsx` and `navigation.tsx`.
>
> **That architecture never ran.** An import-graph reachability check from
> `apps/platform/src/main.tsx` confirmed those files had **zero importers** — the only
> shell mounted by `App.tsx` is `layouts/PlatformShell.tsx`. `navigation.tsx` was also
> regressive: 14 nav entries against the live shell's 46, with 9 paths pointing at routes
> that do not exist (`/hrms/payroll`, `/crm/*`, `/accounts/*`, `/projects/board`,
> `/helpdesk/tickets`).
>
> The dead files were reverted/removed in Phase 0. **The design intent described below was
> delivered in `PlatformShell.tsx` instead**, and this document now describes that live
> implementation.
>
> The discarded work is preserved at
> `scratchpad/phase0-backup/` (patch + two source files) should any of it be wanted again.

---

## 1. Navigation Architecture — THE LIVE ONE

### Single shell

**`apps/platform/src/layouts/PlatformShell.tsx` is the only application shell.**
It is mounted once in `App.tsx` and wraps every authenticated route via `<Outlet/>`.

There is no separate `Sidebar`, `Header` or `TopModuleNav` component. All three regions
are rendered inside `PlatformShell` so that nav state, permission gating and route scoping
cannot drift apart.

### Navigation data

Navigation lives in `PlatformShell.tsx` as `NAV_ITEMS` (flat links) and `MODULE_ITEMS`
(grouped modules, ~46 child entries). It is **not** extracted to a separate config file —
an earlier extraction attempt produced a second, incompatible copy that silently diverged
from the route tree.

If navigation is extracted in future, the extraction must be verified against `App.tsx`
route declarations, and the old copy deleted in the same commit.

### Sidebar (rendered inside PlatformShell)

- **Width:** `w-[272px]`, fixed. No collapse mode.
- **Ground:** `bg-[#08402F]` deep emerald.
- **Groups:** `PEOPLE` · `PAY & BENEFITS` · `ORG & POLICY` · `INSIGHTS` · `SETTINGS`,
  derived from `MODULE_ITEMS` and filtered by `visibleForRoles`.
- **Active state:** white-tint block (`bg-white/[0.14]`), **not** a lighter-green fill —
  a tint keeps the label at ~15.4:1 contrast, whereas a mid-green fill drops to ~4:1.
- **Group captions:** 10px bold uppercase at `text-white/45` (≈4.6:1, AA at that weight).
- **Bottom:** support card that opens the existing global search.

> **Collapse was deliberately not reintroduced.** The previous rail collapse (removed
> 2026-08-22) reclaimed no space — the rail was a fixed width that never resized — so it
> only stripped labels, and its sole toggle lived in the mobile-only drawer, leaving
> desktop users stuck. Do not add a collapse mode without an actual width change and a
> desktop-reachable toggle.

### Header (rendered inside PlatformShell)

- White ground, `border-b`, 72px.
- Global search pill on the left (opens the ⌘K modal).
- App switcher, notification bell, and avatar + name + role on the right.

### Sub-navigation

A section's child routes render as a **segmented pill row directly beneath the header**,
only when the active section has more than one child. They were previously inside the
header itself, where white-on-green pills competed with the search field for the same row.

Sub-tabs are deduped by path — several nav children intentionally share a route.

---

## 2. Shared Primitives

All shared components live in `apps/platform/src/shared/components/hr.tsx` and are used by
60+ screens. Changing one changes the whole product, which is the point.

- **`HrStatCard`** — `rounded-2xl`, white ground, subtle icon gradients, strong typography.
- **`TableCard`** — refined search input, clean headers, consistent borders.
- **`DataTable`** — no internal `ut-card` wrapper, so it does not double-shadow inside
  `TableCard`.
- **`HrTabs`** — segmented control with an isolated pill background and a `framer-motion`
  spring transition on the active indicator.
- **`HrDrawer`** — dark overlay with `backdrop-blur-sm` **on the overlay element only**.
- **`EmptyState` / `SkeletonCard`** — same padding, borders and shadows as real content, so
  loading and empty states do not shift layout.

### ⚠️ Hard constraint: never put `backdrop-filter` on `.ut-card`

An element with `backdrop-filter` becomes the containing block for every
`position: fixed` **descendant**. When `.ut-card` briefly carried it (2026-08-23), every
fixed drawer rendered inside a card stopped being viewport-fixed and was clipped to the
card's box — breaking add/edit drawers on 14 screens. Neither `tsc` nor the build catches
this; it only appears when a drawer opens.

`.ut-glass` exists for surfaces that genuinely need the blur **and** provably contain no
fixed descendant. Overlay panels are the safe case: they *are* the fixed element, not its
ancestor — which is why `HrDrawer`'s blur sits on the overlay.

The `.ut-card.fixed` / `.absolute` / `.sticky` rules in `globals.css` exist for the same
family of bug: `.ut-card` sets `position: relative`, which was silently overriding
Tailwind's `.fixed` on a source-order tiebreak.

---

## 3. Auth Screens

`LoginPage.tsx` uses the shared `.ut-ground` ambient background and the standard token set,
preserving the existing workspace-resolution and auth hooks.

---

## 4. Next Steps

See `HRMS_IMPLEMENTATION_PLAN.md` for the validated phase order. In short:

- **Phase 1–2** — shell completion (breadcrumbs, company context) and the shared UI system
  (FilterBar, bulk selection, rows-per-page, export slots).
- **Phase 3–4** — global search (actions + pages), then dashboard drill-down.
- **Responsive** — below 768px the sidebar becomes a drawer; the sub-tab row scrolls
  horizontally without clipping.

**Before editing any shell or layout file, confirm it is reachable from `main.tsx`.**
Twenty-six files under `apps/platform/src` are currently unreachable; editing one of them
produces no visible change.
