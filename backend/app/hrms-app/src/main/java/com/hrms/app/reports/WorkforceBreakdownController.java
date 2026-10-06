package com.hrms.app.reports;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.rbac.security.PermissionChecker;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Workforce Analytics' breakdowns (by branch, designation, employment type,
 * gender, age and tenure) and joiners per month. Guarded like the reports
 * they sit beside: the breakdowns like the headcount report (the gender one
 * only with the diversity report's permission), the joiners like the
 * attrition report. A date after today (India time) is treated as today.
 */
@RestController
@RequestMapping("/v1/reports")
@Tag(name = "Reports")
@SecurityRequirement(name = "bearerAuth")
public class WorkforceBreakdownController {

    /** The longest joiners range: the attrition tab's periods are at most 12 months. */
    static final int MAX_MONTHS = 24;

    private final WorkforceBreakdownService service;
    private final PermissionChecker perm;

    public WorkforceBreakdownController(WorkforceBreakdownService service, PermissionChecker perm) {
        this.service = service;
        this.perm = perm;
    }

    @GetMapping("/headcount/breakdown")
    @Operation(summary = "Headcount on a date by branch, designation, employment type, age band, tenure band and (with the diversity report) gender")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public WorkforceBreakdown.Breakdown breakdown(
            @RequestParam UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        LocalDate today = LocalDate.now(ReportPdfService.IST);
        LocalDate date = asOf == null || asOf.isAfter(today) ? today : asOf;
        return service.breakdown(companyId, date, perm.check(ReportInsightsService.DIVERSITY));
    }

    @GetMapping("/attrition/joiners")
    @Operation(summary = "People who joined in each month of a period (months without joiners included)")
    @PreAuthorize("@perm.check('hrms.report.attrition')")
    public List<Map<String, Object>> joiners(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        if (from.isAfter(to)) throw new BusinessRuleException("The start date comes after the end date", "REPORT_DATES");
        if (ChronoUnit.MONTHS.between(from.withDayOfMonth(1), to.withDayOfMonth(1)) >= MAX_MONTHS) {
            throw new BusinessRuleException("Choose a period of " + MAX_MONTHS + " months or less", "REPORT_DATES");
        }
        return service.joiners(companyId, from, to, LocalDate.now(ReportPdfService.IST));
    }
}
