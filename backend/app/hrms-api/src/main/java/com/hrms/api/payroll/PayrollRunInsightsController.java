package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Read models for the redesigned run pages, all read-only:
 * <ul>
 *   <li>{@code GET /v1/payroll/runs/{id}/checks} "Checks before you lock" (BW-51),</li>
 *   <li>{@code GET /v1/payroll/runs/{id}/statutory} dues from this run (BW-52),</li>
 *   <li>{@code GET /v1/payroll/runs/{id}/bank-readiness} before the bank file (BW-57,
 *       {@code hrms.disbursement.read} like the bank file itself),</li>
 *   <li>{@code GET /v1/payroll/employees/{employeeId}/payslips} one person's
 *       LOCKED and PAID payslips for HR and finance (BW-58).</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/payroll")
public class PayrollRunInsightsController {

    private final PayrollRunInsightsService insights;
    private final PayrollRunService runs;

    public PayrollRunInsightsController(PayrollRunInsightsService insights, PayrollRunService runs) {
        this.insights = insights;
        this.runs = runs;
    }

    @GetMapping("/runs/{id}/checks")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunInsightsService.RunCheckDto> checks(@PathVariable UUID id) {
        return insights.checks(TenantContext.getTenantId(), id);
    }

    @GetMapping("/runs/{id}/statutory")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunInsightsService.RunStatutoryDto> statutory(@PathVariable UUID id) {
        return insights.statutory(TenantContext.getTenantId(), id);
    }

    @GetMapping("/runs/{id}/bank-readiness")
    @PreAuthorize("hasAuthority('hrms.disbursement.read')")
    public PayrollRunInsightsService.BankReadinessDto bankReadiness(@PathVariable UUID id) {
        return insights.bankReadiness(TenantContext.getTenantId(), id);
    }

    @GetMapping("/employees/{employeeId}/payslips")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.MyPayslipDto> employeePayslips(@PathVariable UUID employeeId) {
        return runs.listEmployeePayslips(TenantContext.getTenantId(), employeeId);
    }
}
