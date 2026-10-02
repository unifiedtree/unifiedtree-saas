package com.hrms.app.reports;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
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
    private final ReportExportLog exportLog;

    public ReportController(ReportService reportService, ReportExportLog exportLog) {
        this.reportService = reportService;
        this.exportLog = exportLog;
    }

    @GetMapping("/headcount")
    @Operation(summary = "Headcount by department as of a given date")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public List<Map<String, Object>> headcount(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.LocalDate).now(T(java.time.ZoneId).of('Asia/Kolkata'))}")
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
            @RequestParam(defaultValue = "#{T(java.time.Year).now(T(java.time.ZoneId).of('Asia/Kolkata')).value}") int year) {
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
    @Operation(summary = "Headcount by gender and department (org diversity); with asOf, the people employed on that date")
    @PreAuthorize("@perm.check('hrms.report.diversity')")
    public List<Map<String, Object>> diversity(
            @RequestParam UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return reportService.diversityReport(companyId, asOf);
    }

    // ── CSV export ────────────────────────────────────────────────────────
    //
    // One thin download endpoint per report, deliberately NOT a single generic
    // /{type}/export.csv. Each JSON report is guarded by its OWN permission
    // (headcount / attrition / attendance / leave / diversity), and a generic
    // route would have to collapse those into one @PreAuthorize — which is
    // exactly how an export endpoint becomes a hole that leaks a report the
    // caller may not read in JSON. Every method below carries the identical
    // guard as its JSON sibling and reuses the same service call, so there is
    // no duplicated SQL and no second definition of "who may see this".

    @GetMapping("/headcount/export.csv")
    @Operation(summary = "Headcount report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.headcount')")
    public ResponseEntity<byte[]> headcountCsv(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.LocalDate).now(T(java.time.ZoneId).of('Asia/Kolkata'))}")
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return csv(ReportKind.HEADCOUNT, companyId, Map.of("asOf", asOf.toString()), reportService.headcountReport(companyId, asOf));
    }

    @GetMapping("/attrition/export.csv")
    @Operation(summary = "Attrition report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attrition')")
    public ResponseEntity<byte[]> attritionCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv(ReportKind.ATTRITION, companyId, Map.of("from", from.toString(), "to", to.toString()), reportService.attritionReport(companyId, from, to));
    }

    @GetMapping("/attendance-summary/export.csv")
    @Operation(summary = "Attendance summary report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public ResponseEntity<byte[]> attendanceSummaryCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv(ReportKind.ATTENDANCE_SUMMARY, companyId, Map.of("from", from.toString(), "to", to.toString()), reportService.attendanceSummaryReport(companyId, from, to));
    }

    @GetMapping("/leave-balance/export.csv")
    @Operation(summary = "Leave balance report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.leave')")
    public ResponseEntity<byte[]> leaveBalanceCsv(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.Year).now(T(java.time.ZoneId).of('Asia/Kolkata')).value}") int year) {
        return csv(ReportKind.LEAVE_BALANCE, companyId, Map.of("year", year), reportService.leaveBalanceReport(companyId, year));
    }

    @GetMapping("/late-marks/export.csv")
    @Operation(summary = "Late-marks report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public ResponseEntity<byte[]> lateMarksCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv(ReportKind.LATE_MARKS, companyId, Map.of("from", from.toString(), "to", to.toString()), reportService.lateMarksReport(companyId, from, to));
    }

    @GetMapping("/diversity/export.csv")
    @Operation(summary = "Diversity report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.diversity')")
    public ResponseEntity<byte[]> diversityCsv(
            @RequestParam UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return csv(ReportKind.DIVERSITY, companyId, asOf == null ? Map.<String, Object>of() : Map.<String, Object>of("asOf", asOf.toString()),
                reportService.diversityReport(companyId, asOf));
    }

    /**
     * Renders report rows as a downloadable CSV ({@link ReportCsv}: the same
     * bytes a scheduled email attaches). An empty result is a valid empty CSV
     * and a 200, not a 500.
     *
     * <p>Every download is written to the export log (hrms.report_exports),
     * which the Reports Center's "Recent downloads" reads.
     */
    private ResponseEntity<byte[]> csv(ReportKind kind, UUID companyId, Map<String, Object> filters, List<Map<String, Object>> rows) {
        String reportName = kind.key();
        byte[] body = ReportCsv.bytes(rows);
        String filename = reportName + "-" + LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")) + ".csv";
        exportLog.record(new ReportExportLog.Entry(kind, "CSV", "SERVER", filename, companyId, null, filters,
                rows.size(), (long) body.length, null, null));
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
        headers.setContentDispositionFormData("attachment", filename);
        headers.setContentLength(body.length);
        return new ResponseEntity<>(body, headers, HttpStatus.OK);
    }
}
