# Multi-Tenancy Guide

## Tenant Isolation Strategy

UnifiedTree uses a **shared database, row-level tenant isolation** model. All tenants share a single PostgreSQL database and schema. Every business table has a `tenant_id UUID NOT NULL` column that references the `tenants` table. Application-level enforcement ensures queries never cross tenant boundaries.

This model was chosen over schema-per-tenant and database-per-tenant for operational simplicity, lower infrastructure cost, and the ability to run migrations across all tenants atomically. The trade-off — slight risk if `tenant_id` is accidentally omitted from a query — is mitigated by the base repository pattern described below.

## Subdomain Routing

Each tenant is assigned a unique subdomain at workspace creation (e.g., `acme.unifiedtree.com`). On every request to `<tenant>.unifiedtree.com`, Nginx passes the full `Host` header to the Spring Boot backend.

`TenantFilter` (a Spring `OncePerRequestFilter`) extracts the subdomain:

```
Host: acme.<tenant>.unifiedtree.com → subdomain = "acme"
```

It then looks up the tenant by subdomain (using a Redis-cached query), resolves the tenant UUID, and stores it in `TenantContext`.

## TenantContext ThreadLocal Pattern

`TenantContext` wraps a `ThreadLocal<UUID>`:

```java
public class TenantContext {
    private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

    public static void set(UUID tenantId) { CURRENT.set(tenantId); }
    public static UUID get() { return CURRENT.get(); }
    public static void clear() { CURRENT.remove(); }
}
```

`TenantFilter` sets it at the start of every request. A `TenantAwareInterceptor` clears it in `afterCompletion` to prevent thread-pool leakage.

All JPA repositories extend `TenantBaseRepository<T, UUID>`, which automatically appends `AND tenant_id = TenantContext.get()` to every query via a Hibernate filter (`@FilterDef` + `@Filter`).

## Workspace Provisioning Flow

When a new tenant completes payment, the provisioning pipeline executes these 10 steps automatically (triggered by a Kafka `PaymentSucceededEvent`):

1. Create `tenants` record with status `PROVISIONING`
2. Reserve the subdomain (unique constraint check + Redis lock)
3. Create the default admin user with a one-time password reset token
4. Activate the modules included in the purchased plan
5. Seed default RBAC roles and permissions for the tenant
6. Create default notification preferences
7. Initialize audit log partition for the tenant
8. Send welcome email with login link and setup guide
9. Update tenant status to `ACTIVE`
10. Publish `TenantProvisionedEvent` to Kafka for downstream consumers (analytics, billing)

If any step fails, a compensating action rolls back completed steps and marks the tenant `PROVISIONING_FAILED`. An ops alert fires and the pipeline can be manually retried via the admin panel.

## Data Isolation Guarantees

- All JPA repositories extend `TenantBaseRepository` which enforces `tenant_id` automatically.
- Direct JPQL/HQL queries must include `:tenantId` as a named parameter — enforced by a custom `ArchUnit` test that fails the build if a `@Query` annotation is found without a `tenant_id` predicate.
- Native queries bypass Hibernate filters; they must include `AND tenant_id = :tenantId` explicitly and are reviewed in PR.
- PostgreSQL Row-Level Security (RLS) is provisioned as a defense-in-depth layer on the `tenants` table itself.

## How to Add tenant_id to a New Entity

Every new entity must follow this template:

```java
@Entity
@Table(name = "my_table")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class MyEntity extends BaseEntity {

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @PrePersist
    protected void prePersist() {
        if (this.tenantId == null) {
            this.tenantId = TenantContext.get();
        }
    }

    // ... other fields
}
```

The corresponding Flyway migration must include:

```sql
CREATE TABLE my_table (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- ... other columns
);

CREATE INDEX idx_my_table_tenant_id ON my_table(tenant_id);
```

The `@PrePersist` hook ensures `tenantId` is populated from `TenantContext` automatically. The `updatable = false` flag prevents accidental re-assignment.

## Super Admin Cross-Tenant Access

Super admins (UnifiedTree internal staff) can access any tenant's data via the admin panel. When a super admin action is authenticated, `TenantFilter` detects the `ROLE_SUPER_ADMIN` claim and sets `TenantContext` to the target tenant ID passed as a request header (`X-Target-Tenant-Id`). Every cross-tenant operation is recorded in the `super_admin_audit_log` table regardless of whether auditing is enabled for the target tenant.

Super admin tokens have a shorter TTL (4 hours) and do not support refresh — re-authentication is required after expiry.
