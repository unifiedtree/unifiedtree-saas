package com.unifiedtree.auth.bootstrap;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Internal helper for {@link InitialAdminBootstrap}. Lives in its own
 * Spring bean so that the {@code @Transactional} advice is actually applied
 * via the proxy on each call -- self-invocation from within
 * {@link InitialAdminBootstrap} would bypass the proxy and skip the
 * transaction setup, which is what we need to get the
 * {@link com.unifiedtree.security.tenant.TenantAwareDataSource} to issue
 * {@code SET LOCAL app.tenant_id} based on the already-set
 * {@code TenantContext}.
 */
@Component
class BootstrapWriter {

    private final JdbcTemplate jdbc;

    BootstrapWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** platform.tenants is not RLS-isolated; this can run without tenant context. */
    @Transactional
    public void insertTenant(UUID tenantId, String subdomain, String displayName, String contactEmail) {
        jdbc.update("""
            INSERT INTO platform.tenants
                (id, subdomain, display_name, contact_email, status, plan_type, created_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 'ENTERPRISE', now())
            """, tenantId, subdomain, displayName, contactEmail);
    }

    /**
     * Inserts the admin user_credentials + SUPER_ADMIN role grant in a
     * single transaction. Caller must have set TenantContext BEFORE
     * invoking, so the @Transactional connection lease triggers
     * SET LOCAL app.tenant_id.
     */
    @Transactional
    public void insertAdminAndGrant(UUID tenantId, UUID userId, String email,
                                    String passwordHash, UUID superAdminRoleId) {
        jdbc.update("""
            INSERT INTO auth.user_credentials
                (id, tenant_id, email, password_hash, is_active,
                 is_biometric_enabled, failed_login_count,
                 created_at, updated_at, created_by, updated_by, version)
            VALUES (?, ?, ?, ?, TRUE, FALSE, 0, now(), now(), 'bootstrap', 'bootstrap', 0)
            """,
            userId, tenantId, email, passwordHash);

        jdbc.update("""
            INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
            VALUES (?, ?, ?, now(), ?)
            """, tenantId, userId, superAdminRoleId, userId);
    }
}
