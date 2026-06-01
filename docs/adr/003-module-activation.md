# ADR 003: Frontend ModuleGate for Dynamic Module Access Control

**Status:** Accepted

**Date:** 2026-01-20

## Context

UnifiedTree business modules (HRMS, CRM, Accounts, etc.) are sold separately. A tenant on the Starter plan might have only HRMS and Accounts activated, while an Enterprise tenant has all nine modules. The platform SPA must:

1. Hide navigation items, pages, and actions for modules the tenant has not purchased.
2. Prevent accidental access to unactivated module routes.
3. Update immediately when a tenant upgrades or downgrades their plan — without requiring a re-deploy.

Additionally, the backend must enforce module access on every API call independently, since frontend-only enforcement is not a security control.

Three approaches were evaluated for the frontend:

**Option A: Route-based redirect**
Add a guard to every React Router route that checks module activation. Unauthorized routes redirect to an "upgrade" page. Works, but requires wrapping every route definition and does not handle inline UI elements (e.g., a button that opens a CRM deal from an HRMS contact page).

**Option B: Feature flags via third-party service (e.g., LaunchDarkly)**
Delegate module gating to a feature flag SaaS. Adds an external dependency and monthly cost. Flag evaluation happens client-side with SDK, which is powerful but overkill for a deterministic, server-driven boolean (is the module in the tenant's plan?). The activated module list is already in the JWT — an external service adds latency and a single point of failure.

**Option C: authStore.activeModules + ModuleGate component + backend annotation**
On successful login, the JWT payload includes `activeModules: ["hrms", "crm", "accounts"]`. The auth store (`authStore`) parses this into a reactive state array. Two primitives are exposed:
- `useModuleActive(moduleKey)` hook — returns `boolean`
- `<ModuleGate module="crm">` component — renders children only if active, otherwise renders a `<UpgradeBanner>` or `null`

The backend uses `@ModuleRequired("crm")` (a custom Spring AOP annotation) on all controllers for a given module, which validates the `activeModules` claim in the JWT on every request.

## Decision

We use **Option C**: `authStore.activeModules` + `ModuleGate` component + `@ModuleRequired` backend annotation.

This provides **double enforcement**:
- **Frontend (UX)**: `ModuleGate` and `useModuleActive` hide UI elements and redirect routes for a clean user experience. This is not a security control.
- **Backend (security)**: `@ModuleRequired` validates the JWT claim on every API request. Even if a tenant manipulates their JWT (impossible with RS256 signing, but included for defense-in-depth), or calls the API directly, the backend rejects requests for inactive modules with `403 MODULE_NOT_ACTIVE`.

When a tenant's plan changes (upgrade or downgrade), the billing service publishes a `PlanChangedEvent` to Kafka. The auth service consumes this event and invalidates all active JWT refresh tokens for the tenant. On next token refresh, the new `activeModules` list is included. Downgrade takes effect within the refresh token TTL (at most 15 minutes for the access token).

## Consequences

**Positive:**

- No external service dependency. Module status is encoded in the JWT and re-evaluated on every token refresh.
- `ModuleGate` is reusable anywhere in the component tree — in nav menus, page bodies, action buttons, and table columns.
- Adding a new module requires only: (1) register the `MODULE_KEY` constant, (2) wrap the module's routes and UI with `<ModuleGate module="new-module">`, (3) annotate the backend controller with `@ModuleRequired("new-module")`.
- Deactivation on plan downgrade is automatic once the new token is issued — no code change required.

**Negative / Trade-offs:**

- There is a window between plan downgrade and token expiry (up to 15 minutes) where a user could still access a module's UI. The backend blocks API calls during this window, so no data is exposed — only stale UI may appear until the next page load after token refresh.
- The `activeModules` array in the JWT grows with each module added. With 9 modules it is negligible; at 50+ modules, JWT size should be monitored.
- If the JWT is not refreshed (e.g., a user leaves a tab open for hours), the UI will not reflect plan changes until the access token is refreshed. Force-refresh is triggered on every navigation action via an `axios` interceptor that checks token expiry.
