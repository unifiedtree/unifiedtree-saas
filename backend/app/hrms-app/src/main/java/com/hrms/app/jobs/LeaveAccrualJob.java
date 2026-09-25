package com.hrms.app.jobs;

import com.hrms.leave.dto.LeaveAccrualDtos.AccrualRunResult;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardResult;
import com.hrms.leave.service.LeaveAccrualService;
import com.hrms.leave.service.LeaveService;
import com.unifiedtree.security.tenant.TenantContext;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Daily leave job, 00:30 IST (QuartzJobConfig), and once at startup to catch a
 * night the instance wasn't running.
 *
 * <ol>
 *   <li><b>Accrual</b>: every live employee (active, on probation or serving
 *       notice) gets a balance for the current leave year for each active leave
 *       type of their company, and MONTHLY / QUARTERLY types are credited up to
 *       what is due today. Idempotent per period (the ledger's unique key), so
 *       running it every day credits each month or quarter once.</li>
 *   <li><b>Year-end carry forward</b>, in January only: unused days of the
 *       year just ended move into this year up to each type's cap and the rest
 *       lapse. Each employee × type is done once; later January runs pick up
 *       only what an earlier run missed.</li>
 * </ol>
 *
 * <p>Tenancy: {@code platform.tenants} is listed without a tenant (it has no
 * row-level security); each tenant then runs in its own REQUIRES_NEW
 * transaction with the tenant bound, so row-level security sees that tenant's
 * rows and a failing tenant never stops the others.
 *
 * <p>2026-09-25 (V143.23): this job used to insert balance rows without an id
 * ({@code leave_balances.id} has no default), so every tenant failed and was
 * only logged; it also skipped people on probation. The work now lives in
 * {@link LeaveAccrualService}.
 */
@Component
@ConditionalOnBean(LeaveService.class)
@DisallowConcurrentExecution
public class LeaveAccrualJob implements Job {

    private static final Logger log = LoggerFactory.getLogger(LeaveAccrualJob.class);
    private static final String ACTOR = "leave-accrual-job";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tenantTx;
    private final LeaveAccrualService accrual;

    public LeaveAccrualJob(JdbcTemplate jdbc, PlatformTransactionManager txManager, LeaveAccrualService accrual) {
        this.jdbc = jdbc;
        this.accrual = accrual;
        this.tenantTx = new TransactionTemplate(txManager);
        this.tenantTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public void execute(JobExecutionContext context) {
        runAllTenants();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        try {
            runAllTenants();
        } catch (Exception e) {
            log.warn("LeaveAccrualJob: startup run failed: {}", e.getMessage());
        }
    }

    public void runAllTenants() {
        LocalDate today = LeaveAccrualService.todayIst();
        List<UUID> tenants;
        try {
            tenants = jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            log.error("LeaveAccrualJob: could not list tenants: {}", e.getMessage());
            return;
        }
        int ok = 0, failed = 0, credited = 0, created = 0;
        for (UUID tenantId : tenants) {
            try {
                AccrualRunResult r = inTenant(tenantId, () -> accrual.accrueTenant(today, null, ACTOR));
                created += r.balancesCreated();
                credited += r.balancesCredited();
                if (today.getMonthValue() == 1) {
                    CarryForwardResult cf = inTenant(tenantId,
                            () -> accrual.runCarryForward(today.getYear() - 1, null, ACTOR, today));
                    if (cf.processed() > 0) {
                        log.info("LeaveAccrualJob: tenant {} carried forward {} line(s) from {}", tenantId, cf.processed(), cf.fromYear());
                    }
                }
                ok++;
            } catch (Exception e) {
                failed++;
                log.warn("LeaveAccrualJob: tenant {} failed: {}", tenantId, e.getMessage());
            }
        }
        log.info("LeaveAccrualJob: {} — tenants ok={} failed={} balances created={} credited={}",
                today, ok, failed, created, credited);
    }

    private <T> T inTenant(UUID tenantId, java.util.function.Supplier<T> work) {
        try {
            return tenantTx.execute(status -> {
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                // Bind the tenant to this transaction (the connection may have been
                // handed out before the context was set).
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
                return work.get();
            });
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }
}
