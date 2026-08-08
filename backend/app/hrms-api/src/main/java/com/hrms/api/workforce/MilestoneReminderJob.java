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
 * Daily birthday / work-anniversary reminders across every active tenant.
 *
 * <p>Mirrors {@link com.hrms.api.probation.ProbationScanJob}: platform.tenants
 * is not RLS-isolated so it can be listed without tenant context, then each
 * tenant runs in its own transaction with its own context, wrapped so one bad
 * tenant never aborts the rest.
 *
 * <p>09:00 IST — after people have picked up their phones, before the working
 * day is underway. Anything earlier and the greeting lands while they are
 * asleep; anything later and colleagues have already missed the morning.
 */
@Component
public class MilestoneReminderJob {

    private static final Logger log = LoggerFactory.getLogger(MilestoneReminderJob.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final MilestoneReminderService reminders;
    private final JdbcTemplate jdbc;

    public MilestoneReminderJob(MilestoneReminderService reminders, JdbcTemplate jdbc) {
        this.reminders = reminders;
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Kolkata")
    public void sendDailyReminders() {
        LocalDate today = LocalDate.now(IST);
        List<UUID> tenantIds = jdbc.queryForList(
                "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        log.info("Milestone reminders starting for {} across {} tenant(s)", today, tenantIds.size());

        int total = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                total += reminders.remindForTenant(tenantId, today);
            } catch (Exception e) {
                log.error("Milestone reminders failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        log.info("Milestone reminders complete: {} milestone(s) announced across {} tenant(s)",
                total, tenantIds.size());
    }
}
