package com.hrms.api.attendance;

import com.hrms.attendance.service.ShiftChangeRequestService;
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
 * Rejects shift-change requests still pending after their start date, so the
 * employee is told promptly and can apply again (client decision 2026-09-24:
 * an expired request is auto-rejected, never started late).
 *
 * <p>Runs just after midnight IST, when yesterday's start dates lapse, and once
 * at startup to catch a night the instance was not running. Approving or
 * re-applying also expires a stale request on the spot, so this job is about
 * telling people, not correctness. Each tenant runs in its own transaction with
 * the tenant bound (no request thread here, so RLS would otherwise see nothing);
 * one tenant failing never stops the rest. Same shape as ProbationScanJob.
 */
@Component
public class ShiftChangeRequestExpiryJob {

    private static final Logger log = LoggerFactory.getLogger(ShiftChangeRequestExpiryJob.class);

    private final ShiftChangeRequestService requests;
    private final JdbcTemplate jdbc;

    public ShiftChangeRequestExpiryJob(ShiftChangeRequestService requests, JdbcTemplate jdbc) {
        this.requests = requests;
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        expireAcrossTenants();
    }

    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Kolkata")
    public void nightly() {
        expireAcrossTenants();
    }

    void expireAcrossTenants() {
        // platform.tenants is not RLS-isolated, so list without tenant context.
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("Shift-change expiry: could not list tenants: {}", e.getMessage(), e);
            return;
        }
        int expired = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                expired += requests.expirePassedForTenant(tenantId);
            } catch (Exception e) {
                log.error("Shift-change expiry failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        log.info("Shift-change expiry: {} request(s) rejected across {} tenant(s)", expired, tenantIds.size());
    }
}
