# ERP Platform — Enterprise Modular SaaS

A production-grade, multi-tenant, domain-driven ERP monorepo built with Vite React, TypeScript, Turborepo, and pnpm workspaces.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTS / BROWSERS                           │
└────────────┬──────────────────┬──────────────────┬──────────────────┘
             │                  │                  │
     ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
     │  @erp/website│  │ @erp/platform│  │  @erp/admin  │
     │  (Marketing) │  │  (App Shell) │  │  (SuperAdmin)│
     └───────┬──────┘  └───────┬──────┘  └───────┬──────┘
             │                  │                  │
     ┌───────▼──────────────────▼──────────────────▼──────┐
     │                  SHARED PACKAGES                    │
     │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
     │  │ @erp/    │  │ @erp/    │  │   @erp/sdk       │  │
     │  │ ui-kit   │  │ types    │  │  (React Query +  │  │
     │  │(Design   │  │(Shared   │  │   API Client)    │  │
     │  │ System)  │  │  Types)  │  └──────────────────┘  │
     │  └──────────┘  └──────────┘                        │
     │  ┌──────────┐  ┌──────────┐                        │
     │  │ @erp/    │  │ @erp/    │                        │
     │  │ utils    │  │ configs  │                        │
     │  │(Helpers) │  │(Tailwind │                        │
     │  │          │  │ ESLint)  │                        │
     │  └──────────┘  └──────────┘                        │
     └─────────────────────────────────────────────────────┘
             │
     ┌───────▼──────────────────────────────────────────────┐
     │                  PLATFORM MODULES                    │
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
     │  │  HRMS    │ │   CRM    │ │ Accounts │ │  more  │  │
     │  │ Module   │ │  Module  │ │  Module  │ │modules │  │
     │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
     └─────────────────────────────────────────────────────-┘
             │
     ┌───────▼──────────────────────────────────────────────┐
     │               BACKEND SERVICES (API)                 │
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
     │  │   Auth   │ │  Tenant  │ │   HRMS   │ │  more  │  │
     │  │ Service  │ │ Service  │ │  Service │ │  APIs  │  │
     │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
     │              Spring Boot / Node.js / PostgreSQL       │
     └──────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | ^5.7.2 |
| Framework | Vite React | ^15.x |
| Monorepo | Turborepo | ^2.3.3 |
| Package Manager | pnpm | 9.15.0 |
| Styling | Tailwind CSS | ^3.4.x |
| State / Data | TanStack Query | ^5.x |
| Icons | Lucide React | ^0.474.0 |
| Linting | ESLint + TypeScript ESLint | latest |
| Formatting | Prettier | ^3.4.2 |
| Node Runtime | Node.js | >=20.0.0 |

---

## Prerequisites

- **Node.js** >= 20.0.0 (use `.nvmrc` with `nvm use`)
- **pnpm** >= 9.0.0 (`npm install -g pnpm@9.15.0`)
- **Git** >= 2.40

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/erp-platform.git
cd erp-platform

# 2. Use the correct Node version
nvm use

# 3. Install all dependencies
pnpm install

# 4. Copy environment files
cp apps/website/.env.example apps/website/.env.local
cp apps/platform/.env.example apps/platform/.env.local

# 5. Run all apps in development mode
pnpm dev

# 6. Or run a specific app
pnpm dev:website    # Marketing site  → http://localhost:3000
pnpm dev:platform   # Platform shell  → http://localhost:3001
pnpm dev:admin      # Super admin     → http://localhost:3002
```

---

## Directory Structure

```
erp-platform/
├── apps/                          # Deployable applications
│   ├── website/                   # Marketing & landing pages (Vite React)
│   │   ├── src/
│   │   │   ├── app/               # App Router pages
│   │   │   ├── components/        # Page-specific components
│   │   │   └── ...
│   │   ├── package.json
│   │   └── next.config.ts
│   ├── platform/                  # Main ERP app shell (Vite React)
│   │   ├── src/
│   │   │   ├── app/               # App Router: dashboard, modules
│   │   │   ├── components/        # Shell components (sidebar, nav)
│   │   │   └── modules/           # Feature modules (HRMS, CRM, etc.)
│   │   ├── package.json
│   │   └── next.config.ts
│   └── admin/                     # Super-admin console (Vite React)
│       ├── src/
│       │   └── app/
│       └── package.json
│
├── packages/                      # Shared internal packages
│   ├── ui-kit/                    # Design system & component library
│   │   └── src/
│   │       ├── components/        # Button, Card, Modal, Table, etc.
│   │       ├── tokens/            # Colors, spacing, typography tokens
│   │       ├── lib/               # cn() utility
│   │       └── index.ts           # Barrel export
│   │
│   ├── shared-types/              # TypeScript type definitions
│   │   └── src/
│   │       ├── entities/          # Domain entities (User, Tenant, etc.)
│   │       ├── api/               # API response/request types
│   │       └── index.ts
│   │
│   ├── sdk/                       # API client + React Query hooks
│   │   └── src/
│   │       ├── client/            # ApiClient class
│   │       ├── hooks/             # useEmployees, useLeads, etc.
│   │       ├── auth/              # TokenManager
│   │       ├── context/           # ApiProvider, useApi
│   │       └── index.ts
│   │
│   ├── configs/                   # Shared config files
│   │   ├── tailwind.preset.js     # Tailwind theme preset
│   │   ├── eslint.js              # ESLint shared config
│   │   └── tsconfig.app.json      # App TypeScript config
│   │
│   └── utilities/                 # Pure utility functions
│       └── src/
│           ├── format.ts          # Currency, date, number formatting
│           ├── validate.ts        # Email, URL, password validation
│           ├── array.ts           # Array helpers
│           ├── object.ts          # Object helpers
│           ├── tenant.ts          # Multi-tenant utilities
│           ├── color.ts           # Color manipulation
│           ├── storage.ts         # Safe localStorage/sessionStorage
│           └── index.ts
│
├── platform/                      # Platform-level shared code
│   ├── shared/                    # Shared platform utilities
│   └── infrastructure/            # Infra abstractions
│
├── scripts/                       # Dev tooling scripts
│   └── generate-module.js         # Scaffold a new ERP module
│
├── package.json                   # Root workspace manifest
├── pnpm-workspace.yaml            # pnpm workspace config
├── turbo.json                     # Turborepo task pipeline
├── tsconfig.base.json             # Base TypeScript config
├── .eslintrc.cjs                  # Root ESLint config
├── .prettierrc                    # Prettier config
├── .gitignore
└── .nvmrc                         # Node version pin
```

---

## Module Development Guide

### Creating a New ERP Module

```bash
# Use the scaffold script
pnpm new-module
# Follow the prompts: name, category, permissions
```

### Module Structure Convention

Every platform module lives under `apps/platform/src/modules/<module-key>/`:

```
modules/hrms/
├── index.ts                  # Module registration & nav config
├── pages/
│   ├── EmployeesPage.tsx
│   ├── AttendancePage.tsx
│   └── PayrollPage.tsx
├── components/
│   ├── EmployeeCard.tsx
│   └── ...
├── hooks/
│   └── useEmployeeFilters.ts
└── types.ts                  # Module-local types (extends @erp/types)
```

### Module Registration

```ts
// modules/hrms/index.ts
export const hrmsModule = {
  key: 'hrms',
  displayName: 'HR Management',
  routes: [...],
  navItems: [...],
  permissions: ['hrms:employees:read', ...],
}
```

---

## Environment Variables Reference

### `apps/website/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_STRIPE_KEY=pk_test_...
```

### `apps/platform/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

### `apps/admin/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_ADMIN_SECRET=...
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps in parallel |
| `pnpm dev:website` | Run marketing site only |
| `pnpm dev:platform` | Run platform app only |
| `pnpm dev:admin` | Run admin console only |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Run ESLint across workspace |
| `pnpm type-check` | Run TypeScript type checking |
| `pnpm test` | Run all test suites |
| `pnpm format` | Format all files with Prettier |
| `pnpm clean` | Remove all build artifacts and node_modules |
| `pnpm new-module` | Scaffold a new ERP module |

---

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification
3. Ensure `pnpm lint` and `pnpm type-check` pass
4. Open a pull request with a clear description

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidelines.

---

## License

MIT License — see [LICENSE](./LICENSE) for details.
