# ADR 002: Shared Database with Row-Level Tenant Isolation

**Status:** Accepted

**Date:** 2026-01-15

## Context

UnifiedTree targets thousands of SMB and mid-market tenants. We need to decide how to isolate tenant data. Three approaches were evaluated:

**Option A: Database-per-tenant**
Each tenant gets a dedicated PostgreSQL database instance. Maximum isolation and simple queries (no `tenant_id` needed), but infrastructure cost scales linearly with tenant count. Managing migrations across thousands of databases is operationally complex and slow. Connection pooling requires a proxy layer (PgBouncer per-database or a multi-tenant pool).

**Option B: Schema-per-tenant**
Each tenant gets a dedicated schema within a shared database. Good isolation without dedicated instances. However, PostgreSQL search-path switching per-request adds complexity. Flyway requires a separate migration run per schema. At 10,000 tenants, schema creation/migration time becomes a bottleneck. Hibernate's schema switching is not well-supported in Spring Boot 3 without significant custom infrastructure.

**Option C: Shared schema with row-level tenant_id**
All tenants share tables. Every table has a `tenant_id UUID NOT NULL` column. Application-level enforcement via `TenantContext` ThreadLocal + Hibernate `@Filter`. PostgreSQL Row-Level Security (RLS) added as defense-in-depth.

## Decision

We use **Option C: shared schema with row-level tenant_id isolation**.

Key implementation details:
- `TenantContext` is a `ThreadLocal<UUID>` set by `TenantFilter` on every request.
- All JPA repositories extend `TenantBaseRepository` which enables a Hibernate `@Filter` named `tenantFilter` that injects `AND tenant_id = :tenantId` into every query.
- `@PrePersist` hooks on all entities auto-populate `tenantId` from `TenantContext`, preventing accidental null insertion.
- An ArchUnit architectural test scans all `@Query` annotations on repositories and fails the build if a native query is found without a `tenant_id` predicate.
- PostgreSQL RLS policies are applied to the most sensitive tables (`users`, `tenants`) as a secondary enforcement layer.

## Alternatives Considered

**Schema-per-tenant** was a serious contender. It was rejected because:
- Flyway requires a separate migration execution per schema, making migration time O(n_tenants) instead of O(1).
- At 10,000+ tenants, even a 100ms migration per schema takes ~17 minutes. With row-level isolation, all tenants are migrated in a single transaction.
- Spring Boot / Hibernate's schema-switching support requires non-trivial custom `CurrentTenantIdentifierResolver` and `MultiTenantConnectionProvider` implementations with poor library support.

**Database-per-tenant** was rejected outright due to cost (each RDS instance costs ~$15-50/month minimum) and operational overhead (10,000 tenants = 10,000 databases to manage).

## Consequences

**Positive:**

- A single Flyway migration run applies to all tenants simultaneously in O(1) time.
- Infrastructure cost is independent of tenant count (up to database resource limits).
- Standard Spring Data JPA repositories work without custom multi-tenant connection management.
- A single `pg_dump` backs up all tenant data.

**Negative / Trade-offs:**

- If a developer forgets `tenant_id` in a raw JPQL/native query, they may inadvertently read or write another tenant's data. Mitigation: Hibernate filter (auto-injected), ArchUnit test (CI enforcement), PostgreSQL RLS (database enforcement), code review checklist.
- Very high-volume tenants can cause query contention. Mitigation: PostgreSQL `tenant_id` indexes on all tables, connection pooling via HikariCP, and future partitioning by `tenant_id` if needed.
- A single noisy-neighbor tenant with a large dataset can degrade query performance for others on the same indexes. Mitigation: per-tenant query timeouts, rate limiting at the API gateway layer.
