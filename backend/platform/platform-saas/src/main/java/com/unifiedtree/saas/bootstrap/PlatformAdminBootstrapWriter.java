package com.unifiedtree.saas.bootstrap;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Helper for {@link PlatformAdminBootstrap}. Lives in its own bean so the
 * {@code @Transactional} advice is applied via the Spring proxy on each
 * call -- self-invocation from PlatformAdminBootstrap would bypass the
 * proxy and skip the SET LOCAL app.tenant_id that the
 * {@code TenantAwareDataSource} issues on connection lease.
 */
@Component
public class PlatformAdminBootstrapWriter {

    private final JdbcTemplate jdbc;

    public PlatformAdminBootstrapWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * platform.tenants is NOT RLS-isolated; this can run without a tenant
     * context set. Idempotent INSERT.
     */
    @Transactional
    public void ensurePlatformTenant(UUID platformTenantId) {
        jdbc.update("""
                INSERT INTO platform.tenants
                    (id, subdomain, display_name, contact_email, status, plan_type, region, created_at)
                VALUES (?, 'unifiedtree', 'UnifiedTree Platform', 'ops@unifiedtree.com',
                        'ACTIVE', 'ENTERPRISE', 'in', now())
                ON CONFLICT (id) DO NOTHING
                """, platformTenantId);
    }

    /**
     * Inserts the platform admin user_credentials + PLATFORM_SUPER_ADMIN
     * role grant in a single transaction. Caller MUST set TenantContext to
     * the platform-tenant id BEFORE invoking, so the @Transactional
     * connection lease triggers SET LOCAL app.tenant_id.
     */
    @Transactional
    public void insertPlatformAdminAndGrant(UUID platformTenantId,
                                            UUID userId,
                                            String email,
                                            String passwordHash,
                                            UUID platformSuperAdminRoleId) {
        jdbc.update("""
                INSERT INTO auth.user_credentials
                    (id, tenant_id, email, password_hash, is_active,
                     is_biometric_enabled, failed_login_count,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, ?, TRUE, FALSE, 0, now(), now(), 'bootstrap', 'bootstrap', 0)
                """, userId, platformTenantId, email, passwordHash);

        jdbc.update("""
                INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
                VALUES (?, ?, ?, now(), ?)
                """, platformTenantId, userId, platformSuperAdminRoleId, userId);
    }
}
