# UnifiedTree — Architecture

## Overview

UnifiedTree is an enterprise-grade multi-tenant SaaS ERP platform built as a monorepo. The platform serves thousands of tenants through a shared-database, row-level isolation model. Business functionality is organized into independently activatable modules (HRMS, CRM, Accounts, Payroll, Inventory, Procurement, Projects, Helpdesk, Analytics), each purchased per-tenant via a subscription plan.

The monorepo goal is to house all frontend apps, shared packages, backend modules, infrastructure configuration, deployment manifests, and developer tooling in a single repository — enabling atomic cross-cutting changes, shared type safety, and unified CI/CD.

## Directory Structure

```
erp-platform/
├── apps/
│   ├── website/          # Marketing site (React + Vite, port 3000)
│   ├── platform/         # Tenant dashboard SPA (port 3001)
│   └── admin/            # Super-admin panel (port 3002)
├── packages/
│   ├── ui-kit/           # Shared React component library (shadcn/ui base)
│   ├── shared-types/     # TypeScript types shared across all apps
│   ├── sdk/              # API client SDK (typed fetch wrappers)
│   ├── configs/          # Shared ESLint, Tailwind, Vite configs
│   └── utilities/        # Date, currency, string helpers
├── platform/
│   └── shared/           # Cross-app React hooks, auth context, module context
├── backend/
│   ├── platform/
│   │   ├── erp-core/     # Base entities, RBAC, TenantContext, repositories
│   │   ├── erp-auth/     # JWT, refresh tokens, MFA
│   │   ├── erp-tenant/   # Subdomain routing, workspace provisioning
│   │   ├── erp-notifications/
│   │   ├── erp-audit/
│   │   └── erp-files/
│   ├── modules/
│   │   ├── mod-hrms/
│   │   ├── mod-crm/
│   │   ├── mod-accounts/
│   │   ├── mod-payroll/
│   │   ├── mod-inventory/
│   │   ├── mod-procurement/
│   │   ├── mod-projects/
│   │   ├── mod-helpdesk/
│   │   └── mod-analytics/
│   ├── services/
│   │   ├── svc-auth/     # Standalone OAuth2/OIDC microservice
│   │   ├── svc-billing/  # Stripe billing microservice
│   │   └── svc-gateway/  # Spring Cloud Gateway
│   └── app/erp-app/      # Boot assembly: imports all platform + module JARs
├── deployments/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   ├── init-db.sql
│   └── k8s/              # Kubernetes manifests
├── docker/               # Dockerfiles + Nginx configs
├── .github/              # CI/CD workflows, PR template
├── scripts/              # setup.sh, dev.sh, seed-db.sh, test-all.sh
└── docs/                 # Architecture, contributing, deployment guides
```

## Three Layers

### 1. Frontend (apps/ + packages/)

Three React 18 + TypeScript + Vite applications share a pnpm workspace orchestrated by Turborepo:

- **website** — public marketing site, landing pages, pricing, blog
- **platform** — authenticated tenant dashboard; renders only the modules the tenant has activated
- **admin** — internal super-admin for managing tenants, plans, and platform health

All apps consume the `@erp/ui-kit` component library, `@erp/shared-types` for API contract types, and `@erp/sdk` for typed API calls. Turborepo caches build artifacts so unchanged packages are never rebuilt.

### 2. Platform Core (backend/platform/)

Six Maven modules that every business module depends on:

- **erp-core** — base JPA entities (BaseEntity with UUID PK + audit fields), TenantContext ThreadLocal, RBAC permission model, module registry
- **erp-auth** — JWT signing/validation, refresh token rotation, MFA (TOTP), Spring Security filter chain
- **erp-tenant** — TenantResolver (extracts subdomain from Host header), workspace provisioning pipeline, tenant CRUD
- **erp-notifications** — in-app notifications, email dispatch via SMTP, Kafka consumer for async notification events
- **erp-audit** — AOP-based audit log writer, tsvector GIN-indexed full-text search
- **erp-files** — S3-compatible file upload/download, presigned URL generation, virus scan hook

### 3. Backend Modules (backend/modules/)

Each module is a self-contained Maven JAR with its own entities, repositories, services, and REST controllers. Modules depend on `erp-core` and `erp-auth` but never on each other — cross-module communication happens via Kafka domain events or the analytics module's read-model queries.

The `erp-app` assembly module imports all platform and business module JARs and boots a single Spring Boot application with `scanBasePackages = "com.nexus.erp"`.

## Multi-Tenancy

Every table carries a `tenant_id UUID NOT NULL` column. `TenantContext` holds the current tenant ID in a `ThreadLocal<UUID>` set by `TenantFilter` on every request (resolved from the JWT claim or subdomain). Base repositories inject `AND tenant_id = :tenantId` into all queries automatically. Super-admin bypass sets a special system context.

## Module System

Each module registers itself with a `MODULE_KEY` constant (e.g., `"hrms"`). The `tenant_modules` table records which keys are active per tenant. On login the auth service populates `activeModules[]` in the JWT. The frontend `ModuleGate` component reads `authStore.activeModules` and renders nothing if the tenant lacks access. Every API controller method is annotated with `@ModuleRequired("hrms")` which validates the claim server-side — frontend gating is UX only.

## Request Flow

```
Browser
  └─> Nginx (TLS termination, SPA routing)
        ├─> website:80     (static React, served from /usr/share/nginx/html)
        ├─> platform:80    (static React + subdomain-aware API calls)
        └─> api.unifiedtree.com
              └─> Spring Boot :8080
                    ├─> TenantFilter (resolve tenant from subdomain/JWT)
                    ├─> JwtAuthFilter (validate token, set SecurityContext)
                    ├─> ModuleGate (validate module activation)
                    └─> Service → JPA Repository → PostgreSQL
```

## Data Flow

**Synchronous**: REST JSON over HTTPS for all CRUD operations. Spring Boot returns paginated DTOs mapped by MapStruct.

**Asynchronous**: Domain events (e.g., `EmployeeHiredEvent`, `InvoicePaidEvent`) are published to Kafka topics. Downstream consumers (Notifications, Audit, Analytics) process them independently, enabling loose coupling without saga orchestration for simple flows.

**Caching**: Redis stores JWT refresh token metadata (TTL = 7 days), session data, and frequently-read tenant configuration. Spring Cache with `@Cacheable` is used at the service layer for tenant/module lookups.

## Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Frontend build | Vite + Turborepo | Sub-second HMR; incremental build cache across monorepo |
| UI components | shadcn/ui + Tailwind | Copy-owned components, zero runtime overhead |
| State management | Zustand | Minimal boilerplate, works with React 18 concurrent features |
| Backend | Spring Boot 3 / Java 21 | Virtual threads (Loom), mature ecosystem, strong JPA support |
| ORM | Spring Data JPA + Hibernate | Native query support, schema validation via Flyway |
| Migrations | Flyway | Versioned SQL migrations, audit trail, CI-safe |
| Auth | JJWT 0.12 | Compact, standards-compliant JWT without extra infrastructure |
| Messaging | Apache Kafka | Durable, replayable domain event bus |
| Database | PostgreSQL 16 | pg_trgm/GIN for full-text search, uuid-ossp, JSONB for metadata |
| Cache | Redis 7 | AOF persistence, fast TTL management |
| Containers | Docker + Compose | Dev parity; production via Kubernetes |
| CI/CD | GitHub Actions | Native GHCR integration, matrix builds, environment protection |
