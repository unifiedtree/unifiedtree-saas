package com.hrms.app.reports;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Sends the report emails that are due. Runs at five past every hour from
 * 07:05 to 23:05 IST: the first run of the day sends that day's emails, later
 * runs catch anything missed while an instance was restarting. Each schedule
 * is claimed before it is sent, so several instances never send it twice.
 *
 * <p>No request thread here, so each tenant runs with its tenant bound (RLS
 * would otherwise see nothing) and one tenant failing never stops the rest.
 * Same shape as KpiAtRiskJob and ShiftChangeRequestExpiryJob.
 */
@Component
public class ReportScheduleJob {

    private static final Logger log = LoggerFactory.getLogger(ReportScheduleJob.class);

    private final ReportScheduleService schedules;
    private final JdbcTemplate jdbc;

    public ReportScheduleJob(ReportScheduleService schedules, JdbcTemplate jdbc) {
        this.schedules = schedules;
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 5 7-23 * * *", zone = "Asia/Kolkata")
    public void hourly() {
        sendAcrossTenants(LocalDate.now(ReportPdfService.IST));
    }

    void sendAcrossTenants(LocalDate today) {
        // platform.tenants is not RLS-isolated, so list without tenant context.
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("Report emails: could not list tenants: {}", e.getMessage(), e);
            return;
        }
        int sent = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                sent += schedules.sendDue(today);
            } catch (Exception e) {
                log.error("Report emails failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        if (sent > 0) log.info("Report emails: {} sent across {} tenant(s)", sent, tenantIds.size());
    }
}
