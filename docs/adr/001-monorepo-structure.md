# ADR 001: Use pnpm Monorepo with Turborepo for Frontend

**Status:** Accepted

**Date:** 2026-01-15

## Context

UnifiedTree requires three distinct React applications:

- **website** — public marketing site targeting anonymous visitors
- **platform** — authenticated tenant SPA with all ERP module UIs
- **admin** — internal super-admin panel for managing tenants, plans, and platform health

These applications share significant code: UI components (buttons, tables, modals, forms), TypeScript types for API contracts, authentication context, module activation context, date/currency utility functions, ESLint configuration, and Tailwind preset.

Before this decision, each app was a separate repository. Problems encountered:

- Type mismatches between the API SDK and consuming apps led to runtime errors discovered only in staging.
- UI component updates required three separate PRs and coordinated merges.
- Developer onboarding required cloning multiple repositories and managing multiple `node_modules` trees.
- There was no enforcement that all apps depended on the same version of a shared utility.

## Decision

Consolidate all frontend apps and shared packages into a single **pnpm workspace** with **Turborepo** as the build orchestrator.

The workspace has two layers:

1. `packages/` — publishable libraries (`@erp/ui-kit`, `@erp/shared-types`, `@erp/sdk`, `@erp/configs`, `@erp/utilities`) that apps consume as workspace dependencies
2. `apps/` — non-publishable application workspaces (`website`, `platform`, `admin`) that consume packages

Turborepo is configured with a `turbo.json` pipeline that declares task dependencies (e.g., `build` depends on `^build`, meaning all upstream packages are built first). Turborepo's content-hash cache means a package that has not changed since the last run is never rebuilt.

## Consequences

**Positive:**

- Single `pnpm install` fetches all dependencies in one pass; a single `node_modules` tree is de-duplicated at the workspace root.
- TypeScript project references enforce compile-time type safety across package boundaries — a breaking API type change fails every consuming app's type-check immediately in CI.
- Turborepo remote cache (or GitHub Actions artifact cache) makes CI build times proportional to the diff size, not the full monorepo size.
- `scripts/generate-module.js` can scaffold both the backend Maven module and the frontend module pages in a single command.
- One PR can change an API type, the SDK wrapper, and the consuming UI simultaneously — no multi-repo coordination.

**Negative / Trade-offs:**

- The repository is larger; shallow clones and sparse checkouts should be used for contributors working only on one app.
- Turborepo adds a build tool dependency. If Turborepo is deprecated, the workspace structure remains valid — only the caching layer is lost.
- pnpm workspace protocol (`workspace:*`) requires all apps to be built from the monorepo root; standalone deployment of a single app requires a Docker build context that includes the whole monorepo.
