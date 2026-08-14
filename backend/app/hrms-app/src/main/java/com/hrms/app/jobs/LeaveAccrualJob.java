package com.hrms.app.jobs;

import com.hrms.leave.service.LeaveService;
import com.unifiedtree.security.tenant.TenantContext;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Runs on the 1st of each month at 00:30 IST (19:00 UTC prior day).
 * Ensures every active employee has a leave balance row for the current year.
 * Also called programmatically on hire and exit events.
 *
 * <p><b>B7 perf + correctness rewrite (2026-08-14):</b>
 * <ul>
 *   <li>The previous implementation ran a single {@code @Transactional} +
 *       {@code employeeRepository.findByEmploymentStatus(ACTIVE, ...)} without
 *       ever touching {@link TenantContext} nor {@code SET LOCAL app.tenant_id}.
 *       RLS on {@code hrms.employees} is {@code tenant_id = current_tenant_id()};
 *       with the GUC unset the policy silently returns ZERO rows — the job
 *       "succeeded" every month while accruing nothing (rls-after-commit-trap
 *       memory).</li>
 *   <li>It also called {@code leaveService.initLeaveBalances} per employee,
 *       which itself ran an N+1 SELECT-then-save loop over the leave types.
 *       For 5k employees × 4 leave types that is 40k DB round-trips per run.</li>
 * </ul>
 * The rewrite iterates {@code platform.tenants} (RLS-free) → for each ACTIVE
 * tenant opens a fresh {@code REQUIRES_NEW} transaction, sets the tenant GUC,
 * pages employees 200 at a time, preloads the tenant's leave-types once, and
 * emits ONE {@code INSERT ... ON CONFLICT DO NOTHING} batch per page.
 */
@Component
@ConditionalOnBean(LeaveService.class)
@DisallowConcurrentExecution
public class LeaveAccrualJob implements Job {

    private static final Logger log = LoggerFactory.getLogger(LeaveAccrualJob.class);
    private static final int PAGE_SIZE = 200;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tenantTx;

    public LeaveAccrualJob(JdbcTemplate jdbc, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.tenantTx = new TransactionTemplate(txManager);
        this.tenantTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public void execute(JobExecutionContext context) {
        int year = LocalDate.now().getYear();
        log.info("LeaveAccrualJob: initialising leave balances for year={}", year);

        // ── Step 1: enumerate ACTIVE tenants OUTSIDE any tenant-scoped tx.
        // platform.tenants has RLS disabled by design (see V002 comment), so
        // this is safe without setting app.tenant_id. Anything under an RLS
        // table here would silently return zero rows.
        List<UUID> tenants = jdbc.queryForList(
                "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'",
                UUID.class);
        if (tenants.isEmpty()) {
            log.info("LeaveAccrualJob: no ACTIVE tenants found — nothing to do");
            return;
        }

        int totalTenants = 0, totalInserted = 0, tenantsFailed = 0;
        for (UUID tenantId : tenants) {
            try {
                int inserted = processTenant(tenantId, year);
                totalTenants++;
                totalInserted += inserted;
            } catch (Exception e) {
                // One bad tenant must not sink the whole run — its REQUIRES_NEW
                // tx rolled back on its own.
                tenantsFailed++;
                log.warn("LeaveAccrualJob: tenant {} failed: {}", tenantId, e.getMessage());
            }
        }
        log.info("LeaveAccrualJob: completed — tenants ok={} failed={} rows inserted={} year={}",
                totalTenants, tenantsFailed, totalInserted, year);
    }

    /**
     * All work for one tenant runs in ONE fresh REQUIRES_NEW transaction so
     * the SET LOCAL below survives every statement in the tx and the tx
     * commits/rolls back independently of its siblings.
     */
    private int processTenant(UUID tenantId, int year) {
        Integer inserted = tenantTx.execute(status -> {
            TenantContext.setTenantId(tenantId);
            try {
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
            } catch (Throwable ignored) { /* older tenant-context bean absent */ }
            // Bind the RLS GUC to this exact transaction. LOCAL scope is
            // required so PgBouncer/Hikari session recycling can't leak it.
            jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");

            // Preload every active leave type for every company in this
            // tenant, keyed by company_id. Doing it once per tenant beats
            // the previous per-employee findByCompanyIdAndActiveTrue call.
            Map<UUID, List<LeaveTypeRow>> typesByCompany = new java.util.HashMap<>();
            jdbc.query("""
                    SELECT id, company_id, annual_entitlement
                      FROM leave_mgmt.leave_types
                     WHERE is_active = TRUE
                    """, rs -> {
                UUID companyId = rs.getObject("company_id", UUID.class);
                typesByCompany
                        .computeIfAbsent(companyId, k -> new ArrayList<>())
                        .add(new LeaveTypeRow(
                                rs.getObject("id", UUID.class),
                                rs.getDouble("annual_entitlement")));
            });
            if (typesByCompany.isEmpty()) return 0;

            int totalRows = 0;
            int offset = 0;
            while (true) {
                List<EmployeeRow> page = jdbc.query("""
                        SELECT id, company_id
                          FROM hrms.employees
                         WHERE employment_status = 'ACTIVE'
                           AND is_active = TRUE
                         ORDER BY id
                         LIMIT ? OFFSET ?
                        """, (rs, i) -> new EmployeeRow(
                                rs.getObject("id", UUID.class),
                                rs.getObject("company_id", UUID.class)),
                        PAGE_SIZE, offset);
                if (page.isEmpty()) break;

                // Build the batch args across (employee × leave-type-of-company).
                List<Object[]> batch = new ArrayList<>(page.size() * 4);
                for (EmployeeRow emp : page) {
                    List<LeaveTypeRow> types = typesByCompany.get(emp.companyId());
                    if (types == null) continue;
                    for (LeaveTypeRow lt : types) {
                        batch.add(new Object[]{
                                tenantId, emp.id(), lt.id(), year, lt.annualEntitlement()
                        });
                    }
                }
                if (!batch.isEmpty()) {
                    int[] rows = jdbc.batchUpdate("""
                            INSERT INTO leave_mgmt.leave_balances
                                (tenant_id, employee_id, leave_type_id, year,
                                 total_entitlement, used, pending, carry_forward)
                            VALUES (?, ?, ?, ?, ?, 0, 0, 0)
                            ON CONFLICT ON CONSTRAINT uq_leave_balance DO NOTHING
                            """, batch);
                    for (int r : rows) if (r > 0) totalRows++;
                }

                if (page.size() < PAGE_SIZE) break;
                offset += page.size();
            }
            return totalRows;
        });
        int n = inserted == null ? 0 : inserted;
        if (n > 0) log.info("LeaveAccrualJob: tenant {} → {} new balance rows", tenantId, n);
        return n;
    }

    private record LeaveTypeRow(UUID id, double annualEntitlement) {}
    private record EmployeeRow(UUID id, UUID companyId) {}
}
