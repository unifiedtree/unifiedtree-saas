# UI Redesign Notes - Ionora HRMS

## Phase 0: Audit Current UI/Component Architecture

### 1. Current Application Structure
- The repository is a pnpm monorepo.
- `apps/website`: Vite + React + Tailwind application handling public marketing pages, login/signup routing, and a lightweight workspace layout placeholder.
- `apps/platform`: Vite + React + Tailwind application acting as the main HRMS product ("Ionora HRMS"). This is where the core HR, payroll, attendance, and settings modules live.
- `packages/ui-kit`: A lightweight shared package, though most HRMS UI components are currently co-located in `apps/platform/src/shared/components`.

### 2. Existing Shared Components
Located primarily in `apps/platform/src/shared/components/hr.tsx`:
- `HrStatCard`: Standard stat/KPI card.
- `HrStatusPill`: Reusable badge/pill.
- `HrPageHeader`: Reusable page header with title, subtitle, breadcrumbs, actions.
- `HrButton`: Primary/ghost buttons.
- `TableCard`: Card wrapper for tables with search and actions.
- `HrAvatar`: Employee avatar with fallback initials.
- `HrTabs` / `HrTabPanel`: Reusable tabs.
- `HrSelect`: Custom select/dropdown.
- `HrDrawer`: Slide-over drawer.
- Layouts: `PlatformShell.tsx` acts as the main application shell.

### 3. Routes/Screens Using Those Components
- Dashboard (`HrmsDashboard.tsx`) uses `KpiTile`, `Card`, `DonutGauge`, `HrStatusPill`, `HrButton`, `SkeletonCardGrid`.
- Modules like `Employees.tsx`, `Leave.tsx`, `Attendance.tsx`, `PayrollRuns.tsx`, etc., use `HrPageHeader`, `TableCard`, `HrTabs`, `HrAvatar`, `HrDrawer`.
- Route configurations are massive in `App.tsx` handling dozens of HRMS routes.

### 4. Current Shell Structure
- Handled by `apps/platform/src/layouts/PlatformShell.tsx`.
- Currently uses a dark-green icon rail (`w-[96px]`) and a top header with in-header sub-tabs.
- App switcher (Odoo-style grid popover).
- Mobile layout uses a drawer.
- **Redesign Need**: The prompt mandates replacing this narrow 96px rail with a fuller sidebar matching the dashboard reference.

### 5. Current Dashboard Implementation
- Handled by `apps/platform/src/modules/hrms/HrmsDashboard.tsx`.
- Implements a responsive grid of KPI tiles, charts (Attendance trend, Headcount by Department), and recent employee tables.
- **Redesign Need**: Needs to exactly match the provided `hrms-dashboard.png` visual reference, especially regarding background treatments (plant/leaf), layout composition, spacing, and typography.

### 6. Existing Design System/Components
- Found in `apps/platform/src/shared/components/hr.tsx` and `apps/platform/src/index.css` (Tailwind config).
- Current colors utilize Emerald (`#0F6E56` family) but lack the specific cohesive premium feel of the reference images.

### 7. What Can Be Reused
- The backend data integrations in `HrmsDashboard.tsx` and all existing route endpoints.
- Component API interfaces (e.g., passing `icon`, `value`, `label` to `StatCard`).
- Existing routing structure (`App.tsx`).

### 8. What Needs Redesign
- The main `PlatformShell.tsx` (sidebar width, hierarchy, top navigation, search).
- The `HrmsDashboard.tsx` layout and visual execution (decorative background, exact card padding, typography hierarchy).
- Shared components in `hr.tsx` (`HrPageHeader`, `TableCard`, `HrTabs`, `HrStatCard`, `HrDrawer`) need visual uplifting to match `main-parts.png`.

### 9. Highest Impact Components
1. **Platform Shell (Sidebar + Top Nav)** - Affects every screen.
2. **Dashboard** - Primary visual north star.
3. **Table & Page Header** - Used on almost every module route.

### 10. Functionality Gaps Discovered
- `HrmsDashboard.tsx` documents that certain charts (Payroll Cost, Positions Hired, Skills radar) were removed because they lacked real backend data. We will need to re-implement visual counterparts if they are in the reference, using mock data and documenting the gap.

## Implementation Progress

### Phase 1: Shell & Dashboard (Completed)
- Updated `PlatformShell.tsx` to feature a 272px wide sidebar and a white enterprise header.
- Updated `HrmsDashboard.tsx` to align exactly with the `hrms-dashboard.png` reference layout, including the background decorative leaf and accurate `ut-card` usage.
- Centralized `.ut-card` styles in `globals.css` with ambient `ut-ground` styling.

### Phase 2: Shared UI Archetypes (Completed)
- Updated `HrPageHeader` with tightened typography.
- Refined `.hr-table` and `TableCard` in `hr.tsx` and `globals.css` with uppercase headers, 44px row heights, and improved toolbar styling.
- Switched `HrTabs` to a premium segmented-control pill layout.
- Upgraded `HrDrawer` with a wider default width and frosted `backdrop-blur-sm` overlay.

### Phase 3: Empty States & Authentication (Completed)
- Standardized `EmptyState.tsx` in `@unifiedtree/ui-kit` to match enterprise tokens.
- Refactored edge-case structural screens (`NoAccess.tsx`, `ModuleNotActivated.tsx`, `ComingSoon.tsx`) to use the exact tokens (`--bg-subtle`, `--text-primary`, `--border-default`) and standard `HrButton` styling.
- Refactored `LoginPage.tsx` to use the globally defined `.ut-ground` class for its ambient background.

## Pending Functionality / Integration
*(To be populated as complex sub-modules are built)*
