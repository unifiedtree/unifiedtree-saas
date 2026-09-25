package com.hrms.api.settings.workspace;

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
 * Hourly danger-zone housekeeping, workspace by workspace (no request thread,
 * so each workspace is bound before its own transactions; one failing never
 * stops the rest; same shape as ShiftChangeRequestExpiryJob):
 * <ul>
 *   <li>reset/delete requests whose 7-day wait ended become DUE and the
 *       owners, admins and platform operator are emailed;</li>
 *   <li>exports older than 7 days are deleted; exports that died with their
 *       server are marked failed.</li>
 * </ul>
 * Several servers may run it at once: each step is a conditional UPDATE, so a
 * request turns DUE (and is announced) exactly once.
 */
@Component
public class WorkspaceDangerZoneJob {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceDangerZoneJob.class);

    private final JdbcTemplate jdbc;
    private final WorkspaceLifecycleService lifecycle;
    private final WorkspaceExportService exports;

    public WorkspaceDangerZoneJob(JdbcTemplate jdbc, WorkspaceLifecycleService lifecycle, WorkspaceExportService exports) {
        this.jdbc = jdbc;
        this.lifecycle = lifecycle;
        this.exports = exports;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        runAll();
    }

    @Scheduled(cron = "0 20 * * * *", zone = "Asia/Kolkata")
    public void hourly() {
        runAll();
    }

    void runAll() {
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class);
        } catch (Exception e) {
            log.error("Danger-zone job: could not list workspaces: {}", e.getMessage());
            return;
        }
        int due = 0, cleaned = 0;
        for (UUID tenantId : tenantIds) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                due += lifecycle.markDue(tenantId);
                cleaned += exports.housekeeping(tenantId);
            } catch (Exception e) {
                log.error("Danger-zone job failed for tenant {}: {}", tenantId, e.getMessage(), e);
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
        if (due > 0 || cleaned > 0) log.info("Danger-zone job: {} request(s) now due, {} export(s) tidied", due, cleaned);
    }
}
