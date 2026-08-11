package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Payroll dashboard reads — powers the Payroll landing page (KPI tiles + cost
 * trend chart). Wave 1 (2026-08-11).
 *
 * <ul>
 *   <li>{@code GET /v1/payroll/dashboard/kpis}  — current-period KPIs</li>
 *   <li>{@code GET /v1/payroll/dashboard/trend?months=6} — 6-month cost trend</li>
 * </ul>
 *
 * Uses the existing {@code payroll.runs.read} authority — anyone allowed to view
 * runs can view the aggregate rollup of those same runs.
 */
@RestController
@RequestMapping("/v1/payroll/dashboard")
public class PayrollDashboardController {

    private final PayrollDashboardService service;

    public PayrollDashboardController(PayrollDashboardService service) {
        this.service = service;
    }

    @GetMapping("/kpis")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public PayrollDashboardService.KpisDto kpis() {
        return service.kpis(TenantContext.getTenantId());
    }

    @GetMapping("/trend")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollDashboardService.TrendPointDto> trend(
            @RequestParam(defaultValue = "6") int months) {
        return service.trend(TenantContext.getTenantId(), months);
    }
}
