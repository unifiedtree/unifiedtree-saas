package com.hrms.api.workforce;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Daily retirement alerts across every active tenant: HR hears 90 days and
 * again 30 days before someone reaches their company's retirement age (see
 * {@link RetirementService#alertForTenant}).
 *
 * <p>Same shape as {@link MilestoneReminderJob} and KpiAtRiskJob:
 * platform.tenants is not RLS-isolated so it is listed without a tenant, then
 * each tenant runs in its own transaction with its tenant bound, and one tenant
 * failing never stops the rest.
 *
 * <p>Runs once a day at 09:05 IST, just after the birthday reminders, so the
 * push arrives in working hours rather than in the middle of the night. It
 * checks the whole 90-day window every day, so a day the service was down is
 * caught up on the next run.
 */
@Component
public class RetirementAlertJob {

    private static final Logger log = LoggerFactory.getLogger(RetirementAlertJob.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final RetirementService retirements;
    private final JdbcTemplate jdbc;

    public RetirementAlertJob(RetirementService retirements, JdbcTemplate jdbc) {
        this.retirements = retirements;
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 5 9 * * *", zone = "Asia/Kolkata")
    public void daily() {
        LocalDate today = LocalDate.now(IST);
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("Retirement alerts: could not list tenants: {}", e.getMessage(), e);
            return;
        }
        int total = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                total += retirements.alertForTenant(tenantId, today);
            } catch (Exception e) {
                log.error("Retirement alerts failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        log.info("Retirement alerts complete for {}: {} alert(s) across {} tenant(s)", today, total, tenantIds.size());
    }
}
