package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Read models for one payroll run in the redesign, all from what the run has
 * already written (nothing here calculates or changes pay):
 * <ul>
 *   <li>BW-51 "Checks before you lock" ({@link #checks}),</li>
 *   <li>BW-52 the statutory dues this run generates ({@link #statutory}),</li>
 *   <li>BW-57 whether the bank file can pay everyone, before a file exists
 *       ({@link #bankReadiness}).</li>
 * </ul>
 * Same tenant binding as PayrollRunService (SET LOCAL inside the transaction),
 * and every statement also filters on the tenant.
 */
@Service
public class PayrollRunInsightsService {

    private final JdbcTemplate jdbc;
    private final PayrollRunService runs;

    public PayrollRunInsightsService(JdbcTemplate jdbc, PayrollRunService runs) {
        this.jdbc = jdbc;
        this.runs = runs;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    /**
     * One check. {@code severity}: INFO, WARNING or CRITICAL. {@code needsReview}:
     * the people in it count as "Needs review" (VARIANCE, MISSING_BANK,
     * FNF_IN_PROGRESS). {@code text} is ready to show ("2 employees are missing
     * bank details").
     */
    public record RunCheckDto(String key, String severity, int count, String text, boolean needsReview,
                              List<UUID> employeeIds) {}

    /**
     * One scheme's dues from the run. {@code dueDate}: PF and ESI the 15th of
     * the next month, TDS the 7th; null for PT and LWF (their date depends on
     * the state). TDS appears only when the run has a TDS line.
     */
    public record RunStatutoryDto(String scheme, String label, BigDecimal employeeShare, BigDecimal employerShare,
                                  BigDecimal total, String dueDate) {}

    /**
     * Before a bank file exists: how many of the run's people (those with pay
     * to send) the file can pay, and what stops the others. The same test as
     * building the file (a primary bank account with a valid IFSC).
     */
    public record BankReadinessDto(UUID runId, String runStatus, int total, int ready, int notReady,
                                   BigDecimal readyAmount, BigDecimal notReadyAmount,
                                   List<BankReadinessLineDto> people) {}

    /** {@code status}: READY, SKIPPED_MISSING_DETAILS or SKIPPED_INVALID_IFSC (the bank file's own words). */
    public record BankReadinessLineDto(UUID employeeId, String employeeCode, String employeeName, BigDecimal netPay,
                                       String bankName, String bankLast4, String status, String problem) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<RunCheckDto> checks(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        PayrollRunService.RunRow run = requireRun(runId);
        List<PayrollRunService.RunEmployeeDto> rows = runs.listRunEmployees(tenantId, runId);
        List<PayrollInsights.Person> people = new ArrayList<>(rows.size());
        for (PayrollRunService.RunEmployeeDto r : rows) {
            people.add(new PayrollInsights.Person(r.employeeId(), r.employeeName(), r.netPay(), r.changePercent(),
                    r.hasBankAccount(), r.fnfInProgress(),
                    r.dateOfJoining() == null ? null : java.time.LocalDate.parse(r.dateOfJoining()), r.lopDays()));
        }
        List<UUID> skipped = runs.listSkippedEmployees(tenantId, runId).stream()
                .map(PayrollRunService.EligibleEmployeeDto::employeeId).toList();
        YearMonth prev = YearMonth.of(run.periodYear(), run.periodMonth()).minusMonths(1);
        return PayrollInsights.checks(people, skipped, run.periodStart(), run.periodEnd(),
                        PayrollInsights.periodLabel(prev.getMonthValue(), prev.getYear()))
                .stream()
                .map(c -> new RunCheckDto(c.key(), c.severity(), c.count(), c.text(), c.needsReview(), c.employeeIds()))
                .toList();
    }

    @Transactional
    public List<RunStatutoryDto> statutory(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        PayrollRunService.RunRow run = requireRun(runId);
        Map<String, BigDecimal> amounts = new HashMap<>();
        jdbc.query("""
            SELECT component_code, sum(amount) AS total
              FROM payroll.payslip_lines
             WHERE tenant_id = ? AND run_id = ?
               AND component_code IN ('PF_EMPLOYEE','PF_EMPLOYER','ESI_EMPLOYEE','ESI_EMPLOYER','PT',
                                      'LWF_EMPLOYEE','LWF_EMPLOYER','TDS')
             GROUP BY component_code
            """, (RowCallbackHandler) rs -> amounts.put(rs.getString("component_code"), rs.getBigDecimal("total")),
            tenantId, runId);
        return PayrollInsights.statutoryDues(amounts, run.periodYear(), run.periodMonth()).stream()
                .map(d -> new RunStatutoryDto(d.scheme(), d.label(), d.employeeShare(), d.employerShare(), d.total(), d.dueDate()))
                .toList();
    }

    @Transactional
    public BankReadinessDto bankReadiness(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        PayrollRunService.RunRow run = requireRun(runId);
        List<BankReadinessLineDto> people = jdbc.query("""
            SELECT l.employee_id, e.employee_code,
                   trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,''))                AS name,
                   coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                 - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0)                AS net,
                   ba.id IS NOT NULL AS has_account, ba.ifsc_code, ba.bank_name, ba.account_number_last4
              FROM payroll.payslip_lines l
              JOIN hrms.employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
              LEFT JOIN LATERAL (SELECT a.id, a.ifsc_code, a.bank_name, a.account_number_last4
                                   FROM hrms.employee_bank_accounts a
                                  WHERE a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.is_primary = TRUE
                                  ORDER BY a.updated_at DESC LIMIT 1) ba ON TRUE
             WHERE l.tenant_id = ? AND l.run_id = ?
             GROUP BY l.employee_id, e.employee_code, e.first_name, e.last_name,
                      ba.id, ba.ifsc_code, ba.bank_name, ba.account_number_last4
            HAVING coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                 - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0) > 0
             ORDER BY e.employee_code
            """, (rs, i) -> {
                boolean has = rs.getBoolean("has_account");
                String ifsc = rs.getString("ifsc_code");
                return new BankReadinessLineDto(rs.getObject("employee_id", UUID.class), rs.getString("employee_code"),
                        rs.getString("name"), rs.getBigDecimal("net"), rs.getString("bank_name"),
                        rs.getString("account_number_last4"),
                        PayrollInsights.bankStatus(has, ifsc), PayrollInsights.bankProblem(has, ifsc));
            }, tenantId, runId);
        return summarise(runId, run.status(), people);
    }

    /** Totals over the people lines (package-visible for tests). */
    static BankReadinessDto summarise(UUID runId, String runStatus, List<BankReadinessLineDto> people) {
        int ready = 0;
        BigDecimal readyAmount = BigDecimal.ZERO, notReadyAmount = BigDecimal.ZERO;
        for (BankReadinessLineDto p : people) {
            BigDecimal net = p.netPay() == null ? BigDecimal.ZERO : p.netPay();
            if ("READY".equals(p.status())) {
                ready++;
                readyAmount = readyAmount.add(net);
            } else {
                notReadyAmount = notReadyAmount.add(net);
            }
        }
        return new BankReadinessDto(runId, runStatus, people.size(), ready, people.size() - ready,
                readyAmount, notReadyAmount, people);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private PayrollRunService.RunRow requireRun(UUID runId) {
        PayrollRunService.RunRow run = runs.findRun(runId);
        // Same answer as every other run endpoint for an unknown run.
        if (run == null) throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        return run;
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
