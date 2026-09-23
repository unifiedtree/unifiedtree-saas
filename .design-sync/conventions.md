# UnifiedTree HRMS — how to build with this design system

**One namespace, two layers.** Everything is on `window.UnifiedTree`. The HRMS primitives
(`HrPageHeader`, `HrStatCard`, `HrStatusPill`, `HrButton`, `HrAvatar`, `HrTabs`/`HrTabPanel`,
`HrSelect`, `HrDrawer`, `TableCard`, `FilterBar`, `DataTable`, `HrPagination`, `EmptyState`,
`StatCard`, `SkeletonCard`…) are what every HRMS screen is actually built from — **reach for
them first**. The generic kit (`Button`, `Badge`, `Card*`, `Field`/`Input`/`Label`, `Modal`,
`Drawer`, `Tabs*`, `PageHeader`, `Avatar`, `Separator`, `Skeleton*`) sits underneath; use it
inside forms and dialogs. `DataTable`, `EmptyState` and `StatCard` here are the HRMS versions.

**Anatomy of a list screen** (Employees, Attendance, Leave, Advances, Expenses…):
1. `HrPageHeader` — `title`, `subtitle`, `crumb` ("HRMS / Payroll"), `actions` = `HrButton`s,
   `tabs` = `HrTabs` (with `badge` counts), `filters` slot for a `FilterBar`.
2. KPI strip — `<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">` of `HrStatCard`
   (`icon` is a lucide **element**: `<Wallet size={18} />`; `color` blue|green|orange|red|purple|teal;
   `trend={{dir:'up', value:'3.2%'}}`; `loading` swaps the value for a skeleton; `onClick` makes it a drill-down).
3. `TableCard` — toolbar (`search`, `filters` as `FilterDef[]`, `actions`), body, `footer`
   (`HrPagination` / `hrPaginationFooter`) — wrapping `DataTable` (`columns` with `render`,
   `keyField`; first column `HrAvatar name sub`; status column `HrStatusPill`; row action
   `HrButton size="sm" variant="ghost"`). Keep tables to ≤5–6 columns; wide content goes in `render`.
4. `EmptyState` (`icon` is the lucide **component**: `icon={Users}`) when there are no rows;
   `SkeletonCardGrid` / `TableSkeleton` while loading.

**Detail and edit.** `HrDrawer` (right-hand panel, `title`, `footer` actions, `width` like
`max-w-lg`) for a record; `Modal` (`size` sm|md|lg|xl) for confirmations and short forms;
destructive confirms go through `ConfirmDialogProvider` + `useConfirmDialog()`.

**Status language — pick a tone, never a colour.** `HrStatusPill tone`: `ok`/`green` approved,
present · `warn` pending · `late`/`orange` late, half day · `info`/`blue` in review, scheduled ·
`teal` work from home · `purple` on leave · `pink` probation · `red` rejected, absent ·
`gray` draft, closed, weekly off. `Badge` (generic) has its own `tone` set for non-HR labels.

**Buttons.** `HrButton` — `variant` primary (emerald) | ghost | danger, `size` sm | md — on HRMS
screens. `Button` — primary | secondary | outline | ghost | danger | danger-ghost | link, sizes
xs…lg + icon, `loading`, `leftIcon`/`rightIcon` — inside forms and dialogs.

**Content conventions.** Indian formatting: `'₹' + n.toLocaleString('en-IN')` → ₹1,20,000;
dates `18 Sep 2026`; employee codes `EMP-0142`; `tabular-nums` on numeric cells. Real HR
wording (Approved / Pending approval / On leave / Half day / Work from home).

**Look and tokens.** White cards (`.ut-card`, ring-1 ring-gray-200, rounded-2xl, soft shadow) on
a light canvas; emerald accent `--accent-fg` (#0f6e56) with mint `#10b981` highlights; text
`--text-primary / --text-secondary / --text-tertiary`; borders `--border-default / --border-subtle`;
surfaces `--bg-surface / --bg-subtle`. All tokens are in `tokens/tokens.css`; dark theme is
`data-theme="dark"` on the root. Fonts: **Plus Jakarta Sans** for display/headings
(`font-display`), **Inter** for body, **JetBrains Mono** for code — loaded by `styles.css`.

**Don't.** Don't rebuild tables, cards or pills from raw `div`s — compose the primitives.
Don't hand-pick status colours. Don't put an `HrStatCard` strip in a narrow column. Don't use
Tailwind classes the app never uses (the stylesheet is purged to real usage) — prefer the
components' own props, or tokens via `var(--…)`.
