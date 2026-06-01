package com.unifiedtree.auth.bootstrap;

import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * One-time production bootstrap: creates the very first platform tenant +
 * SUPER_ADMIN user from environment variables when the database has zero
 * tenants. Runs once at startup, then becomes a no-op forever.
 *
 * <p>Activates only when:
 * <ul>
 *   <li>{@code UNIFIEDTREE_BOOTSTRAP_ENABLED=true}</li>
 *   <li>AND all required envs are set
 *       ({@code UNIFIEDTREE_BOOTSTRAP_TENANT_SUBDOMAIN},
 *        {@code UNIFIEDTREE_BOOTSTRAP_ADMIN_EMAIL},
 *        {@code UNIFIEDTREE_BOOTSTRAP_ADMIN_PASSWORD})</li>
 *   <li>AND {@code platform.tenants} contains zero rows.</li>
 * </ul>
 *
 * <p>The DB writes are delegated to {@link BootstrapWriter} (a separate
 * Spring bean) so that {@code @Transactional} is applied via the proxy
 * AFTER this class has set {@link TenantContext} -- otherwise the
 * connection lease happens before the tenant is known and the
 * {@link com.unifiedtree.security.tenant.TenantAwareDataSource}'s
 * {@code SET LOCAL app.tenant_id} skips, causing the RLS WITH CHECK on
 * {@code auth.user_credentials} to reject the insert.
 */
@Component
@Order(50)
public class InitialAdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(InitialAdminBootstrap.class);

    private static final UUID SUPER_ADMIN_ROLE_ID =
        UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final JdbcTemplate jdbc;
    private final PasswordService passwords;
    private final BootstrapWriter writer;

    private final boolean enabled;
    private final String  tenantSubdomain;
    private final String  tenantDisplayName;
    private final String  adminEmail;
    private final String  adminPassword;

    public InitialAdminBootstrap(
            JdbcTemplate jdbc,
            PasswordService passwords,
            BootstrapWriter writer,
            @Value("${unifiedtree.bootstrap.enabled:false}") boolean enabled,
            @Value("${unifiedtree.bootstrap.tenant-subdomain:}") String tenantSubdomain,
            @Value("${unifiedtree.bootstrap.tenant-display-name:}") String tenantDisplayName,
            @Value("${unifiedtree.bootstrap.admin-email:}") String adminEmail,
            @Value("${unifiedtree.bootstrap.admin-password:}") String adminPassword) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.writer = writer;
        this.enabled = enabled;
        this.tenantSubdomain   = tenantSubdomain;
        this.tenantDisplayName = tenantDisplayName.isBlank() ? tenantSubdomain : tenantDisplayName;
        this.adminEmail        = adminEmail;
        this.adminPassword     = adminPassword;
    }

    @Override
    public void run(String... args) {
        if (!enabled) return;
        if (tenantSubdomain.isBlank() || adminEmail.isBlank() || adminPassword.isBlank()) {
            log.warn("Bootstrap requested but required envs are missing - skipping. "
                + "Set UNIFIEDTREE_BOOTSTRAP_TENANT_SUBDOMAIN, _ADMIN_EMAIL, _ADMIN_PASSWORD.");
            return;
        }
        if (adminPassword.length() < 12) {
            log.error("Bootstrap admin password is shorter than 12 characters - refused.");
            return;
        }

        // Idempotency: skip if any tenant already exists. platform.tenants
        // is NOT RLS-isolated so this count is authoritative.
        Integer tenantCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM platform.tenants", Integer.class);
        if (tenantCount != null && tenantCount > 0) {
            log.info("Bootstrap: {} tenant(s) already exist - skipping.", tenantCount);
            return;
        }

        UUID tenantId = UUID.randomUUID();
        UUID userId   = UUID.randomUUID();

        // Step 1: tenant row (platform.tenants - not RLS-isolated).
        writer.insertTenant(tenantId, tenantSubdomain, tenantDisplayName, adminEmail);

        // Step 2: set tenant context BEFORE the next transactional call so
        // SET LOCAL app.tenant_id lands on the connection that
        // BootstrapWriter.insertAdminAndGrant() leases via @Transactional.
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            writer.insertAdminAndGrant(tenantId, userId, adminEmail,
                passwords.hash(adminPassword), SUPER_ADMIN_ROLE_ID);
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }

        log.warn("Bootstrap complete: tenant={} admin={} userId={}.",
            tenantSubdomain, adminEmail, userId);
        log.warn("REMOVE the UNIFIEDTREE_BOOTSTRAP_* environment variables now.");
    }
}
