package com.hrms.api.workforce;

import com.hrms.employee.workforce.service.MilestoneWindow;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Retirement due (HR Configuration → retirement age applied).
 *
 * <ul>
 *   <li>{@code GET /v1/hrms/retirements/due}: people reaching their company's
 *       retirement age within {@code days} (default 90), soonest first, or
 *       between {@code from} and {@code to} (both included, at most 12 months:
 *       the dashboard card's chosen range). Needs {@code hrms.employee.read},
 *       the same as reading the employee records the dates come from.</li>
 *   <li>{@code POST /v1/hrms/retirements/alerts/run}: send this workspace's due
 *       retirement alerts now instead of waiting for the daily job. Safe to
 *       repeat: each alert goes once per person and date.</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/hrms/retirements")
public class RetirementController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** Longest look-ahead one request may ask for (five years). */
    static final int MAX_DAYS = 1830;

    private final RetirementService retirements;

    public RetirementController(RetirementService retirements) {
        this.retirements = retirements;
    }

    @Operation(summary = "People reaching their company's retirement age within the next N days")
    @GetMapping("/due")
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    public List<RetirementService.RetirementDue> due(
            @RequestParam(defaultValue = "90") int days,
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        MilestoneWindow.Range range = MilestoneWindow.Range.optional(from, to);
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) return List.of();
        LocalDate today = LocalDate.now(IST);
        if (range != null) return retirements.between(tenantId, today, range.from(), range.to(), companyId);
        return retirements.due(tenantId, today, Math.max(0, Math.min(MAX_DAYS, days)), companyId);
    }

    @Operation(summary = "Send this workspace's due retirement alerts now (idempotent)")
    @PostMapping("/alerts/run")
    @PreAuthorize("hasAuthority('hrms.retirement.alerts')")
    public RunResponse runAlerts() {
        UUID tenantId = TenantContext.getTenantId();
        LocalDate today = LocalDate.now(IST);
        if (tenantId == null) return new RunResponse(0, today);
        return new RunResponse(retirements.alertForTenant(tenantId, today), today);
    }

    /** {@code sent}: people an alert went out for in this run (0 when they were all sent before). */
    public record RunResponse(int sent, LocalDate date) {}
}
