package com.hrms.app.reports;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/reports")
@Tag(name = "Reports", description = "Six canonical HRMS analytical reports")
@SecurityRequirement(name = "bearerAuth")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/headcount")
    @Operation(summary = "Headcount by department as of a given date")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public List<Map<String, Object>> headcount(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.LocalDate).now()}")
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return reportService.headcountReport(companyId, asOf);
    }

    @GetMapping("/attrition")
    @Operation(summary = "Monthly attrition (exits + resignations + terminations)")
    @PreAuthorize("@perm.check('hrms.report.attrition')")
    public List<Map<String, Object>> attrition(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reportService.attritionReport(companyId, from, to);
    }

    @GetMapping("/attendance-summary")
    @Operation(summary = "Per-employee attendance summary (present days, late days, avg hours, overtime)")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public List<Map<String, Object>> attendanceSummary(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reportService.attendanceSummaryReport(companyId, from, to);
    }

    @GetMapping("/leave-balance")
    @Operation(summary = "Leave balances for all active employees for a given year")
    @PreAuthorize("@perm.check('hrms.report.leave')")
    public List<Map<String, Object>> leaveBalance(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        return reportService.leaveBalanceReport(companyId, year);
    }

    @GetMapping("/late-marks")
    @Operation(summary = "All late-mark records within a date range, sorted by minutes late")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public List<Map<String, Object>> lateMarks(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reportService.lateMarksReport(companyId, from, to);
    }

    @GetMapping("/diversity")
    @Operation(summary = "Headcount by gender and department (org diversity)")
    @PreAuthorize("@perm.check('hrms.report.diversity')")
    public List<Map<String, Object>> diversity(@RequestParam UUID companyId) {
        return reportService.diversityReport(companyId);
    }
}
