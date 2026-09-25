package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Marks KPIs "At risk" once their due date has passed and they're under 100%.
 * {@link KpiService#flipOverdueToAtRisk} existed since Wave 4 but nothing ever
 * called it, so overdue KPIs stayed "Active" forever (found 2026-09-25).
 *
 * <p>Runs just after midnight IST and once at startup (to catch a night the
 * instance was down). Each tenant runs in its own transaction with the tenant
 * bound; one tenant failing never stops the rest. Same shape as
 * ShiftChangeRequestExpiryJob and ProbationScanJob.
 */
@Component
public class KpiAtRiskJob {

    private static final Logger log = LoggerFactory.getLogger(KpiAtRiskJob.class);

    private final KpiService kpis;
    private final JdbcTemplate jdbc;

    public KpiAtRiskJob(KpiService kpis, JdbcTemplate jdbc) {
        this.kpis = kpis;
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        flipAcrossTenants();
    }

    @Scheduled(cron = "0 15 0 * * *", zone = "Asia/Kolkata")
    public void nightly() {
        flipAcrossTenants();
    }

    void flipAcrossTenants() {
        // platform.tenants is not RLS-isolated, so list without tenant context.
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("KPI at-risk sweep: could not list tenants: {}", e.getMessage(), e);
            return;
        }
        int flipped = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                flipped += kpis.flipOverdueToAtRisk(tenantId);
            } catch (Exception e) {
                log.error("KPI at-risk sweep failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        log.info("KPI at-risk sweep: {} KPI(s) marked at risk across {} tenant(s)", flipped, tenantIds.size());
    }
}
