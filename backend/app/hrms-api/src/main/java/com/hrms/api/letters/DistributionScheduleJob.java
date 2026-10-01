package com.hrms.api.letters;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Starts scheduled letter distributions on their date (redesign BW-73), from
 * {@value DistributionScheduleService#SEND_HOUR}:00 India time. Runs every ten
 * minutes and once at startup, so a send missed while no server was running
 * starts on the next run. Only due sends start, each in its own transaction
 * with its tenant bound (no request thread here, so row-level security would
 * otherwise see nothing); one failing never stops the rest. Two servers never
 * start the same send: each claims it first. Same shape as
 * ShiftChangeRequestExpiryJob.
 */
@Component
public class DistributionScheduleJob {

    private static final Logger log = LoggerFactory.getLogger(DistributionScheduleJob.class);

    private final DistributionScheduleService schedules;
    private final JdbcTemplate jdbc;

    public DistributionScheduleJob(DistributionScheduleService schedules, JdbcTemplate jdbc) {
        this.schedules = schedules;
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        runAcrossTenants(ZonedDateTime.now());
    }

    @Scheduled(cron = "0 */10 * * * *", zone = "Asia/Kolkata")
    public void everyTenMinutes() {
        runAcrossTenants(ZonedDateTime.now());
    }

    /** @return how many distributions were started */
    int runAcrossTenants(ZonedDateTime now) {
        if (!schedules.ready()) return 0;
        LocalDate through = DistributionScheduleService.dueThrough(now);
        // platform.tenants is not RLS-isolated, so list without tenant context.
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("Scheduled letters: could not list tenants: {}", e.getMessage(), e);
            return 0;
        }
        int started = 0;
        for (UUID tenantId : tenantIds) {
            try {
                bind(tenantId);
                for (UUID id : schedules.dueIds(tenantId, through)) {
                    try {
                        if (schedules.startOne(tenantId, id, through) != null) started++;
                    } catch (Exception e) {
                        log.warn("Scheduled letters: send {} in tenant {} could not start: {}", id, tenantId, e.getMessage());
                        bind(tenantId);
                        try {
                            schedules.markFailed(tenantId, id, e.getMessage());
                        } catch (Exception e2) {
                            log.error("Scheduled letters: could not record the failure of {}: {}", id, e2.getMessage());
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Scheduled letters failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        if (started > 0) log.info("Scheduled letters: {} distribution(s) started", started);
        return started;
    }

    private static void bind(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
    }
}
