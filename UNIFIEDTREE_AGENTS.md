# UnifiedTree HRMS --- AGENTS.md

## Mission

Build and recover a coherent enterprise HRMS UI/UX while preserving real
backend behavior, permissions, tenant isolation, and working workflows.

Read `docs/platform/CODEX_MASTER_CONTEXT.md` before major changes.

## Live architecture

Frontend:
`main.tsx → App.tsx → PlatformShell.tsx → routes → pages → shared components → hooks → API`

Backend: Spring Boot 3 / Java 21 / PostgreSQL / Flyway / JWT / RBAC /
RLS.

Storage: Cloudflare R2 via existing `R2Storage`.

## Architectural rules

-   `PlatformShell.tsx` is the live shell.
-   Do not revive:
    -   `shared/layouts/Sidebar.tsx`
    -   `shared/layouts/Header.tsx`
    -   `shared/layouts/DashboardLayout.tsx`
    -   `TopModuleNav.tsx`
    -   old/dead `navigation.tsx`
-   Do not create a second navigation source of truth.
-   Do not create duplicate dashboards/shells.
-   Trace live reachability from `main.tsx`.
-   Do not revive canonical-dead backend beans casually.

## No fake functionality

-   Never invent an API.
-   Never invent database fields.
-   Never fake backend data.
-   Never use client-side filtering to pretend an API supports
    server-side filtering.
-   A frontend stub does not count as backend integration.
-   Do not mark a control as functional until its real workflow is
    verified.

## Permissions

Preserve existing RBAC/RLS. Use the permission actually checked by the
backend controller, not merely an SDK constant.

## Protected areas

Avoid casual rewrites of: - PayrollEngine.java - LopCalculator.java -
leave services/entities/migrations - RBAC/RLS migrations - stable
notifications - stable onboarding

## Current P0

1.  Restore dashboard KPI strip click/permission behavior.
2.  Fix dashboard attendance drilldown semantics.
3.  Restore coherent desktop navigation; currently many destinations are
    hidden.
4.  Fix SalaryStructureAdmin DataTable bindings.

Then: 5. Document upload using the existing
R2Storage/UserAvatarController pattern. 6. Employee-specific read gaps.
7. Re-audit architecture.

## UI/UX standard

Every screen must have: - clear purpose - obvious primary action -
predictable navigation - consistent shared components - loading state -
empty state - error state - permission state where applicable -
responsive behavior - keyboard/focus accessibility - meaningful
destinations for displayed metrics - no dead controls

## Verification

Before claiming completion: - TypeScript clean - build clean - relevant
frontend tests - relevant backend tests/integration tests - browser
acceptance where possible - no meaningful console errors - verify actual
API behavior - report anything not executed

## Current client problem

The client considers the current UI poor and difficult to use, and
reports that functionality feels broken.

Treat this as a product usability + functional-truth problem, not merely
a styling task.

## Agent behavior

Do not blindly implement screenshots. Use screenshots as visual
references and written screen specs as behavior contracts.

For every major task report: - problem - existing behavior - planned
change - files/routes/APIs - exclusions - verification - remaining
issues
