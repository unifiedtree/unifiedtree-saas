package com.hrms.api.saasguard;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * The one query TenantModuleGuard needs, lifted out of the legacy
 * SaasPlatformService which drags in JwtTokenProvider, MailService and a
 * legacy signup path — none of which live in the canonical-prod scan.
 *
 * <p>Fully-qualified {@code platform.tenant_modules} because the legacy
 * version omitted the schema (relying on {@code search_path}), and once the
 * bean loaded in a canonical-prod context that assumption did not hold.
 */
@Component
public class TenantModuleLookup {

    private final JdbcTemplate jdbc;

    public TenantModuleLookup(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean hasActiveModule(UUID tenantId, String moduleKey) {
        Boolean active = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM platform.tenant_modules
                     WHERE tenant_id = ? AND module_key = ? AND status = 'ACTIVE'
                )
                """, Boolean.class, tenantId, moduleKey);
        return Boolean.TRUE.equals(active);
    }
}
