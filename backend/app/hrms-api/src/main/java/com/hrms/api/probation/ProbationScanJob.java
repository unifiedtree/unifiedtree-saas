package com.hrms.api.probation;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Daily probation reminder scan. {@code @EnableScheduling} is active on
 * HrmsApplication. Runs across all ACTIVE tenants; each tenant is scanned in its
 * own transaction (inside {@link ProbationService#scanForTenant}) and wrapped in
 * try/catch so one tenant failing never aborts the rest. Tenant context is set
 * per-tenant and always cleared.
 */
@Component
public class ProbationScanJob {

    private static final Logger log = LoggerFactory.getLogger(ProbationScanJob.class);

    private final ProbationService probationService;
    private final JdbcTemplate jdbc;

    public ProbationScanJob(ProbationService probationService, JdbcTemplate jdbc) {
        this.probationService = probationService;
        this.jdbc = jdbc;
    }

    /** Daily at 08:00 IST. platform.tenants is not RLS-isolated, so list without tenant context. */
    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Kolkata")
    public void scanAllTenants() {
        List<UUID> tenantIds = jdbc.queryForList(
            "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        log.info("Probation scan starting across {} tenant(s)", tenantIds.size());

        int total = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                total += probationService.scanForTenant(tenantId);
            } catch (Exception e) {
                log.error("Probation scan failed for tenant {}: {}", tenantId, e.getMessage(), e);
                // continue to the next tenant
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        log.info("Probation scan complete: {} reminder(s) fired across {} tenant(s)", total, tenantIds.size());
    }
}
