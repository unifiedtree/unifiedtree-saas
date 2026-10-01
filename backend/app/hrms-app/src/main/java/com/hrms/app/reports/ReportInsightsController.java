package com.hrms.app.reports;

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
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The small numbers around the reports (redesign P-REPORTS): the Reports
 * Center's hero deltas and tile series, and Workforce analytics' headcount
 * trend and fiscal-year period. Each endpoint is guarded like the report it
 * summarises; the summary returns each series only with that report's own
 * permission (checked in the service, the same check the report uses).
 */
@RestController
@RequestMapping("/v1/reports")
@Tag(name = "Reports", description = "Six canonical HRMS analytical reports")
@SecurityRequirement(name = "bearerAuth")
public class ReportInsightsController {

    static final String ANY_REPORT = "@perm.hasAny('hrms.report.headcount','hrms.report.attrition','hrms.report.attendance',"
            + "'hrms.report.leave','hrms.report.diversity')";

    private final ReportInsightsService insights;
    private final PermissionChecker perm;

    public ReportInsightsController(ReportInsightsService insights, PermissionChecker perm) {
        this.insights = insights;
        this.perm = perm;
    }

    @GetMapping("/headcount/change")
    @Operation(summary = "Headcount on two dates, the change between them, and who joined and left in between")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public Map<String, Object> headcountChange(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return insights.headcountChange(companyId, from, to);
    }

    @GetMapping("/headcount/trend")
    @Operation(summary = "Headcount at each month's end for the last N months (the newest month on the 'to' date, today by default)")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public List<Map<String, Object>> headcountTrend(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "6") int months,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return insights.headcountTrend(companyId, months, to, LocalDate.now(ReportPdfService.IST));
    }

    @GetMapping("/summary")
    @Operation(summary = "One small series per report for the Reports Center tiles; each only with that report's permission")
    @PreAuthorize(ANY_REPORT)
    public Map<String, Object> summary(@RequestParam UUID companyId) {
        return insights.summary(companyId, LocalDate.now(ReportPdfService.IST), perm::check);
    }

    @GetMapping("/fiscal-year")
    @Operation(summary = "The company's fiscal year containing a date (today by default)")
    @PreAuthorize(ANY_REPORT)
    public Map<String, Object> fiscalYear(
            @RequestParam UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return insights.fiscalYear(companyId, asOf == null ? LocalDate.now(ReportPdfService.IST) : asOf);
    }
}
