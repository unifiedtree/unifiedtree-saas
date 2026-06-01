# Contributing to UnifiedTree

## Prerequisites

Before you begin, ensure the following tools are installed and at the correct versions:

| Tool | Minimum Version | Install |
|---|---|---|
| Node.js | 20.x | https://nodejs.org |
| pnpm | 9.x | `npm i -g pnpm` |
| Java JDK | 21 | https://adoptium.net |
| Maven | 3.9+ | https://maven.apache.org |
| Docker | 24+ | https://docker.com |

## Setup

```bash
git clone https://github.com/your-org/erp-platform.git
cd erp-platform
./scripts/setup.sh
```

`setup.sh` performs the following automatically:
1. Verifies all prerequisites
2. Runs `pnpm install` to install all frontend dependencies
3. Builds shared packages (`@erp/ui-kit`, `@erp/shared-types`)
4. Copies `.env.example` to `.env` if not already present
5. Starts PostgreSQL, Redis, and Kafka via Docker Compose
6. Pre-fetches Maven dependencies offline

To start all services together:

```bash
./scripts/dev.sh
```

Or start individual services:

```bash
# Backend (Spring Boot)
cd backend && mvn spring-boot:run -pl app/erp-app -am

# Frontend apps (from monorepo root)
pnpm dev:website    # http://localhost:3000
pnpm dev:platform   # http://localhost:3001
pnpm dev:admin      # http://localhost:3002
```

## Branch Naming

All branches must follow the convention below. PRs from branches that do not match will be rejected by the branch protection rule.

| Prefix | Use for |
|---|---|
| `feature/*` | New features or modules |
| `fix/*` | Bug fixes |
| `chore/*` | Dependency updates, tooling, CI changes |
| `docs/*` | Documentation only changes |
| `refactor/*` | Code restructuring without behavior change |
| `test/*` | Adding or fixing tests |

Examples:
- `feature/crm-pipeline-board`
- `fix/hrms-leave-balance-calculation`
- `chore/upgrade-spring-boot-3.3`

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must have the form:

```
<type>(<scope>): <description>

[optional body]
```

Valid types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`

Scope is the module or package affected, e.g., `hrms`, `crm`, `erp-core`, `ui-kit`, `ci`.

Examples:
```
feat(hrms): add bulk employee import via CSV
fix(erp-auth): refresh token not rotated on concurrent requests
chore(deps): upgrade JJWT to 0.12.5
docs(architecture): add Kafka data flow diagram
```

## Running Tests

Run all checks with the single script:

```bash
./scripts/test-all.sh
```

This runs in order:
1. TypeScript type-check (`pnpm type-check`)
2. ESLint (`pnpm lint`)
3. Frontend build verification (`pnpm build`)
4. Backend unit + integration tests (`cd backend && mvn -B test`)

Individual checks:
```bash
# Frontend
pnpm type-check
pnpm lint
pnpm --filter website test

# Backend
cd backend && mvn test
cd backend && mvn test -pl modules/mod-hrms
```

## Creating a New ERP Module

Use the scaffolding script to generate a new module with the correct structure:

```bash
node scripts/generate-module.js --name payroll --display "Payroll"
```

This creates:
- `backend/modules/mod-{name}/pom.xml` with standard dependencies
- `backend/modules/mod-{name}/src/main/java/com/nexus/erp/{name}/` with entity, repository, service, controller stubs
- `apps/platform/src/modules/{name}/` with React page, store, and API hook stubs
- A Flyway migration stub in `backend/app/erp-app/src/main/resources/db/migration/`

After scaffolding:
1. Add the module to `backend/pom.xml` `<modules>` section
2. Add the dependency to `backend/app/erp-app/pom.xml`
3. Register the `MODULE_KEY` constant in `erp-core`
4. Add the module activation entry in `erp-core`'s module registry
5. Write your Flyway migration SQL

## PR Checklist

Before opening a pull request:

- [ ] All tests pass (`./scripts/test-all.sh`)
- [ ] TypeScript compiles without errors
- [ ] ESLint reports no errors
- [ ] No hardcoded tenant IDs, credentials, or environment-specific URLs
- [ ] Database migrations are backward-compatible (no destructive column drops without a multi-step process)
- [ ] New environment variables are added to `.env.example` with a comment
- [ ] Breaking changes are described in the PR body
- [ ] UI changes include before/after screenshots

## Code Style

- Write self-documenting code. Add a comment only when the reason for a decision is non-obvious — not to describe what the code does.
- Do not commit half-finished features behind a `TODO` comment. Use a feature flag or keep the work on a branch.
- Java: follow Spring conventions, use constructor injection, keep controllers thin (delegate to services).
- TypeScript: prefer explicit types over `any`, co-locate component files with their hooks and tests.
- SQL: all new tables must have `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`, `tenant_id UUID NOT NULL REFERENCES tenants(id)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, and `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
