package com.hrms.api.policy;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

/**
 * Policy notices in the background (V143.23):
 * <ul>
 *   <li>every two minutes: send whatever is still pending (a restart or a
 *       mail outage), and queue the "new policy" email for a policy published
 *       in the last two days whose notices were never queued;</li>
 *   <li>daily at 09:30 IST: queue the automatic reminders that are due.</li>
 * </ul>
 * Each tenant runs in its own transaction with the tenant bound (no request
 * thread here); one tenant failing never stops the rest.
 */
@Component
public class PolicyNoticeJob {

    private static final Logger log = LoggerFactory.getLogger(PolicyNoticeJob.class);

    private final PolicyNoticeService notices;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public PolicyNoticeJob(PolicyNoticeService notices, JdbcTemplate jdbc, PlatformTransactionManager txManager) {
        this.notices = notices;
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Scheduled(fixedDelay = 120_000, initialDelay = 90_000)
    public void sendPending() {
        forEachTenant(false);
    }

    @Scheduled(cron = "0 30 9 * * *", zone = "Asia/Kolkata")
    public void dailyReminders() {
        forEachTenant(true);
    }

    void forEachTenant(boolean reminders) {
        List<UUID> tenants;
        try {
            tenants = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.warn("Policy notices: could not list tenants: {}", e.getMessage());
            return;
        }
        for (UUID tenantId : tenants) {
            try {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                Integer queued = tx.execute(status -> {
                    jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
                    return (reminders ? notices.queueAutoReminders() : 0) + notices.queueMissedPublished();
                });
                if (queued != null && queued > 0) log.info("Policy notices: {} queued for tenant {}", queued, tenantId);
                notices.dispatchPending(tenantId);
            } catch (Exception e) {
                log.warn("Policy notices failed for tenant {}: {}", tenantId, e.getMessage());
            } finally {
                TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        }
    }
}
