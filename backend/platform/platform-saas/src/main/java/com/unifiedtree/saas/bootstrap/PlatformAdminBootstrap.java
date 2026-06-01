package com.unifiedtree.saas.bootstrap;

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
 * One-time creation of the UnifiedTree platform admin (the user who logs in
 * at {@code /v1/platform/auth/login} and approves tenant requests).
 *
 * <p>Lives in the special "platform tenant" with id
 * {@code 00000000-0000-0000-0000-000000000000}. Idempotent: skips if the
 * platform tenant row already exists with at least one user.
 *
 * <p>Activates only when:
 * <ul>
 *   <li>{@code UNIFIEDTREE_PLATFORM_ADMIN_ENABLED=true}</li>
 *   <li>{@code UNIFIEDTREE_PLATFORM_ADMIN_EMAIL} is set</li>
 *   <li>{@code UNIFIEDTREE_PLATFORM_ADMIN_PASSWORD} is set ({@code >= 12} chars)</li>
 * </ul>
 *
 * <p>Runs after {@code InitialAdminBootstrap} (Order 50) so the demo tenant
 * exists first. The two are independent though -- platform admin lives in
 * its own dedicated platform tenant row.
 */
@Component
@Order(60)
public class PlatformAdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminBootstrap.class);

    /** The fixed platform-tenant id. Matches {@code SaasService.PLATFORM_TENANT_ID}. */
    static final UUID PLATFORM_TENANT_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000000");

    private static final UUID PLATFORM_SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000006");

    private final JdbcTemplate jdbc;
    private final PasswordService passwords;
    private final PlatformAdminBootstrapWriter writer;
    private final boolean enabled;
    private final String  email;
    private final String  name;
    private final String  password;

    public PlatformAdminBootstrap(
            JdbcTemplate jdbc,
            PasswordService passwords,
            PlatformAdminBootstrapWriter writer,
            @Value("${unifiedtree.platform-admin.enabled:false}") boolean enabled,
            @Value("${unifiedtree.platform-admin.email:}") String email,
            @Value("${unifiedtree.platform-admin.name:UnifiedTree Admin}") String name,
            @Value("${unifiedtree.platform-admin.password:}") String password) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.writer = writer;
        this.enabled = enabled;
        this.email = email;
        this.name = name;
        this.password = password;
    }

    @Override
    public void run(String... args) {
        if (!enabled) return;
        if (email.isBlank() || password.isBlank()) {
            log.warn("Platform admin bootstrap enabled but required envs missing - skipping. "
                    + "Set UNIFIEDTREE_PLATFORM_ADMIN_EMAIL and _PASSWORD.");
            return;
        }
        if (password.length() < 12) {
            log.error("Platform admin password is shorter than 12 characters - refused.");
            return;
        }

        // Idempotency: skip if the platform tenant already has any users.
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth.user_credentials WHERE tenant_id = ?",
                Integer.class, PLATFORM_TENANT_ID);
        if (existing != null && existing > 0) {
            log.info("Platform admin bootstrap: {} user(s) already exist in platform tenant - skipping.",
                    existing);
            return;
        }

        // Ensure the special platform tenant row exists.
        writer.ensurePlatformTenant(PLATFORM_TENANT_ID);

        UUID userId = UUID.randomUUID();
        TenantContext.setTenantId(PLATFORM_TENANT_ID);
        try {
            writer.insertPlatformAdminAndGrant(
                    PLATFORM_TENANT_ID, userId,
                    email.trim().toLowerCase(),
                    passwords.hash(password),
                    PLATFORM_SUPER_ADMIN_ROLE_ID);
        } finally {
            TenantContext.clear();
        }

        log.warn("Platform admin bootstrap complete: email={} userId={}.", email, userId);
        log.warn("REMOVE the UNIFIEDTREE_PLATFORM_ADMIN_* environment variables now.");
    }
}
