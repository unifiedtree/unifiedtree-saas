package com.unifiedtree.security.tenant;

import java.util.UUID;

/**
 * Thread-local tenant context resolved at the start of each HTTP request from
 * the bearer JWT (claim {@code tenant_id}) or the {@code X-Tenant-ID} header
 * for service-to-service calls.
 *
 * <p>This context is the <em>only</em> source of truth for which tenant a
 * thread is operating on. Every Postgres transaction issues
 * {@code SET LOCAL app.tenant_id = '<uuid>'} from this value so that
 * Row-Level Security policies can isolate rows.
 *
 * <p>Never read tenant identity from request parameters, path variables, or
 * the body - always read it here.
 */
public final class TenantContext {

    /** Sentinel for unscoped platform-admin operations (e.g. tenant approval). */
    public static final UUID PLATFORM_TENANT_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000000");

    private static final ThreadLocal<UUID> TENANT_ID = new ThreadLocal<>();
    private static final ThreadLocal<UUID> USER_ID   = new ThreadLocal<>();

    private TenantContext() { }

    public static void setTenantId(UUID tenantId) { TENANT_ID.set(tenantId); }
    public static UUID getTenantId() { return TENANT_ID.get(); }
    public static UUID requireTenantId() {
        UUID id = TENANT_ID.get();
        if (id == null) {
            throw new IllegalStateException(
                "No tenant set on this thread. Did the JwtAuthenticationFilter run?");
        }
        return id;
    }

    public static void setUserId(UUID userId) { USER_ID.set(userId); }
    public static UUID getUserId() { return USER_ID.get(); }

    public static void clear() {
        TENANT_ID.remove();
        USER_ID.remove();
    }
}
