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
            @RequestParam(defaultValue = "#{T(java.time.LocalDate).now()}")
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return csv("headcount", reportService.headcountReport(companyId, asOf));
    }

    @GetMapping("/attrition/export.csv")
    @Operation(summary = "Attrition report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attrition')")
    public ResponseEntity<byte[]> attritionCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv("attrition", reportService.attritionReport(companyId, from, to));
    }

    @GetMapping("/attendance-summary/export.csv")
    @Operation(summary = "Attendance summary report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public ResponseEntity<byte[]> attendanceSummaryCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv("attendance-summary", reportService.attendanceSummaryReport(companyId, from, to));
    }

    @GetMapping("/leave-balance/export.csv")
    @Operation(summary = "Leave balance report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.leave')")
    public ResponseEntity<byte[]> leaveBalanceCsv(
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        return csv("leave-balance", reportService.leaveBalanceReport(companyId, year));
    }

    @GetMapping("/late-marks/export.csv")
    @Operation(summary = "Late-marks report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.attendance')")
    public ResponseEntity<byte[]> lateMarksCsv(
            @RequestParam UUID companyId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return csv("late-marks", reportService.lateMarksReport(companyId, from, to));
    }

    @GetMapping("/diversity/export.csv")
    @Operation(summary = "Diversity report as a CSV download")
    @PreAuthorize("@perm.check('hrms.report.diversity')")
    public ResponseEntity<byte[]> diversityCsv(@RequestParam UUID companyId) {
        return csv("diversity", reportService.diversityReport(companyId));
    }

    /**
     * Renders report rows as a downloadable CSV.
     *
     * <p>Column order comes from the first row's key order — Spring's
     * {@code JdbcTemplate.queryForList} returns insertion-ordered maps, so the
     * columns match the SELECT list rather than coming out alphabetised.
     *
     * <p>An empty result is a header-less but VALID empty CSV and a 200, not a
     * 500 — "no leavers this month" is a legitimate answer to a report.
     *
     * <p>A UTF-8 BOM is prepended so Excel on Windows opens rupee symbols and
     * non-ASCII names correctly instead of mojibake; every other reader
     * tolerates it.
     */
    private ResponseEntity<byte[]> csv(String reportName, List<Map<String, Object>> rows) {
        StringBuilder out = new StringBuilder();
        if (!rows.isEmpty()) {
            List<String> columns = List.copyOf(rows.get(0).keySet());
            out.append(String.join(",", columns.stream().map(ReportController::escapeCsv).toList()))
               .append("\r\n");
            for (Map<String, Object> row : rows) {
                List<String> cells = columns.stream()
                        .map(column -> escapeCsv(row.get(column)))
                        .toList();
                out.append(String.join(",", cells)).append("\r\n");
            }
        }
        byte[] body = ("\uFEFF" + out).getBytes(StandardCharsets.UTF_8);
        String filename = reportName + "-" + LocalDate.now() + ".csv";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
        headers.setContentDispositionFormData("attachment", filename);
        headers.setContentLength(body.length);
        return new ResponseEntity<>(body, headers, HttpStatus.OK);
    }

    /**
     * RFC-4180 escaping: a field is quoted when it contains a comma, a double
     * quote, CR or LF, and embedded quotes are doubled. Null becomes empty.
     */
    private static String escapeCsv(Object value) {
        if (value == null) return "";
        String text = String.valueOf(value);
        boolean mustQuote = text.indexOf(',') >= 0 || text.indexOf('\"') >= 0
                || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0;
        if (!mustQuote) return text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }
}
