package com.hrms.app.reports;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Server-side PDF downloads of every report page and of the Workforce
 * Analytics snapshot, plus the export log behind the Reports Center's
 * "Recent downloads".
 *
 * <p>Like the CSV routes in {@link ReportController}, each PDF has its own
 * route with its report's own permission, so a download is never a wider door
 * than the report screen. Every download is written to the export log.
 */
@RestController
@RequestMapping("/v1/reports")
@Tag(name = "Report exports", description = "Report PDFs and the shared export log")
@SecurityRequirement(name = "bearerAuth")
public class ReportExportController {

    static final String ANY_REPORT = "hasAnyAuthority('hrms.report.headcount','hrms.report.attrition','hrms.report.attendance',"
            + "'hrms.report.leave','hrms.report.diversity','hrms.report.exports.read_all')";

    private final ReportPdfService pdfs;
    private final ReportExportLog exportLog;
    private final JdbcTemplate jdbc;

    public ReportExportController(ReportPdfService pdfs, ReportExportLog exportLog, JdbcTemplate jdbc) {
        this.pdfs = pdfs;
        this.exportLog = exportLog;
        this.jdbc = jdbc;
    }

    // ── PDFs ─────────────────────────────────────────────────────────────────

    @GetMapping("/headcount/export.pdf")
    @Operation(summary = "Headcount report as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.headcount')")
    public ResponseEntity<byte[]> headcountPdf(@RequestParam UUID companyId,
                                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf,
                                               Authentication auth) {
        LocalDate day = asOf == null ? LocalDate.now(ReportPdfService.IST) : asOf;
        return pdf(ReportKind.HEADCOUNT, new ReportPdfService.Params(companyId, null, null, day, null), auth, Map.of("asOf", day.toString()));
    }

    @GetMapping("/attrition/export.pdf")
    @Operation(summary = "Attrition report as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.attrition')")
    public ResponseEntity<byte[]> attritionPdf(@RequestParam UUID companyId,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                               Authentication auth) {
        return pdf(ReportKind.ATTRITION, range(companyId, from, to), auth, Map.of("from", from.toString(), "to", to.toString()));
    }

    @GetMapping("/attendance-summary/export.pdf")
    @Operation(summary = "Attendance summary as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.attendance')")
    public ResponseEntity<byte[]> attendancePdf(@RequestParam UUID companyId,
                                                @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                Authentication auth) {
        return pdf(ReportKind.ATTENDANCE_SUMMARY, range(companyId, from, to), auth, Map.of("from", from.toString(), "to", to.toString()));
    }

    @GetMapping("/leave-balance/export.pdf")
    @Operation(summary = "Leave balance report as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.leave')")
    public ResponseEntity<byte[]> leavePdf(@RequestParam UUID companyId,
                                           @RequestParam(required = false) Integer year,
                                           Authentication auth) {
        int y = year == null ? LocalDate.now(ReportPdfService.IST).getYear() : year;
        if (y < 2000 || y > 2100) throw new com.hrms.core.exception.BusinessRuleException("Choose a year between 2000 and 2100", "REPORT_YEAR_INVALID");
        return pdf(ReportKind.LEAVE_BALANCE, new ReportPdfService.Params(companyId, null, null, null, y), auth, Map.of("year", y));
    }

    @GetMapping("/late-marks/export.pdf")
    @Operation(summary = "Late marks report as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.attendance')")
    public ResponseEntity<byte[]> lateMarksPdf(@RequestParam UUID companyId,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                               Authentication auth) {
        return pdf(ReportKind.LATE_MARKS, range(companyId, from, to), auth, Map.of("from", from.toString(), "to", to.toString()));
    }

    @GetMapping("/diversity/export.pdf")
    @Operation(summary = "Diversity report as a PDF")
    @PreAuthorize("hasAuthority('hrms.report.diversity')")
    public ResponseEntity<byte[]> diversityPdf(@RequestParam UUID companyId, Authentication auth) {
        return pdf(ReportKind.DIVERSITY, new ReportPdfService.Params(companyId, null, null, null, null), auth, Map.of());
    }

    /** The Workforce Analytics snapshot: each section only with its own report permission. */
    @GetMapping("/workforce-analytics/export.pdf")
    @Operation(summary = "Workforce Analytics snapshot as a PDF (sections follow the caller's report permissions)")
    @PreAuthorize("hasAnyAuthority('hrms.report.headcount','hrms.report.attrition','hrms.report.diversity')")
    public ResponseEntity<byte[]> analyticsPdf(@RequestParam UUID companyId,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                               Authentication auth) {
        LocalDate today = LocalDate.now(ReportPdfService.IST);
        ReportPdfService.Params p = range(companyId, from, to);
        return pdf(ReportKind.WORKFORCE_ANALYTICS, new ReportPdfService.Params(companyId, p.from(), p.to(), today, null), auth,
                Map.of("from", from.toString(), "to", to.toString(), "asOf", today.toString()));
    }

    // ── Export log ───────────────────────────────────────────────────────────

    /**
     * The Reports Center's "Recent downloads". People with
     * hrms.report.exports.read_all see the whole workspace's history (the
     * default for them); everyone else sees their own downloads.
     */
    @GetMapping("/exports")
    @Operation(summary = "Report download history (whole workspace with hrms.report.exports.read_all, else your own)")
    @PreAuthorize(ANY_REPORT)
    public Map<String, Object> exports(@RequestParam(required = false) String scope,
                                       @RequestParam(defaultValue = "0") int page,
                                       @RequestParam(defaultValue = "20") int size,
                                       Authentication auth) {
        boolean canAll = held(auth).contains("hrms.report.exports.read_all");
        if ("all".equalsIgnoreCase(scope) && !canAll) {
            throw new AccessDeniedException("Seeing everyone's downloads needs hrms.report.exports.read_all");
        }
        boolean all = canAll && !"mine".equalsIgnoreCase(scope);
        Map<String, Object> out = new LinkedHashMap<>(exportLog.list(all, page, size));
        out.put("canSeeAll", canAll);
        return out;
    }

    /** A file the browser built (Excel workbook, chart PNG, on-screen CSV), recorded by the page that made it. */
    public record BrowserExport(String report, String format, String fileName, UUID companyId,
                                Map<String, Object> filters, Integer rowCount, Long sizeBytes) {}

    @PostMapping("/exports")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Record a report file the browser built (you must be able to open that report)")
    @PreAuthorize("hasAnyAuthority('hrms.report.headcount','hrms.report.attrition','hrms.report.attendance',"
            + "'hrms.report.leave','hrms.report.diversity','audit.read','hrms.employee.read')")
    public Map<String, Object> recordBrowserExport(@RequestBody BrowserExport body, Authentication auth) {
        ReportKind kind = ReportKind.fromKey(body == null ? null : body.report())
                .orElseThrow(() -> new com.hrms.core.exception.BusinessRuleException("Unknown report", "REPORT_UNKNOWN"));
        if (!kind.openableWith(held(auth))) {
            throw new AccessDeniedException("You can't open the " + kind.label().toLowerCase() + ", so you can't record an export of it");
        }
        String format = body.format() == null ? "" : body.format().trim().toUpperCase();
        if (!List.of("CSV", "XLSX", "PNG").contains(format)) {
            throw new com.hrms.core.exception.BusinessRuleException("Format must be CSV, XLSX or PNG", "REPORT_EXPORT_FORMAT");
        }
        if (body.fileName() == null || body.fileName().isBlank()) {
            throw new com.hrms.core.exception.BusinessRuleException("A file name is required", "REPORT_EXPORT_FILE");
        }
        Map<String, Object> filters = body.filters() == null ? Map.of() : sanitize(body.filters());
        UUID id = exportLog.record(new ReportExportLog.Entry(kind, format, "BROWSER", body.fileName().trim(), body.companyId(), null,
                filters, body.rowCount(), body.sizeBytes(), null, null));
        if (id == null) throw new IllegalStateException("The download could not be recorded");
        return Map.of("id", id);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private ResponseEntity<byte[]> pdf(ReportKind kind, ReportPdfService.Params p, Authentication auth, Map<String, Object> filters) {
        ReportPdfService.Rendered r = pdfs.render(kind, p, held(auth), "Downloaded by " + whoAmI());
        exportLog.record(new ReportExportLog.Entry(kind, "PDF", "SERVER", r.fileName(), p.companyId(), r.companyName(),
                filters, r.rowCount(), (long) r.bytes().length, null, null));
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(r.fileName()).build());
        headers.setContentLength(r.bytes().length);
        return new ResponseEntity<>(r.bytes(), headers, HttpStatus.OK);
    }

    private static ReportPdfService.Params range(UUID companyId, LocalDate from, LocalDate to) {
        if (from.isAfter(to)) {
            throw new com.hrms.core.exception.BusinessRuleException("'From' must be on or before 'To'", "REPORT_RANGE_INVALID");
        }
        if (from.plusYears(3).isBefore(to)) {
            throw new com.hrms.core.exception.BusinessRuleException("Choose a range of three years or less", "REPORT_RANGE_TOO_LONG");
        }
        return new ReportPdfService.Params(companyId, from, to, null, null);
    }

    static Set<String> held(Authentication auth) {
        if (auth == null) return Set.of();
        return auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).collect(Collectors.toCollection(HashSet::new));
    }

    /** The signed-in person's name (or email) for the "Downloaded by" line. */
    private String whoAmI() {
        UUID me = com.unifiedtree.security.tenant.TenantContext.getUserId();
        if (me == null) return "a workspace member";
        try {
            List<String> names = jdbc.queryForList("""
                    SELECT COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), c.email)
                      FROM auth.user_credentials c LEFT JOIN hrms.employees e ON e.id = c.employee_id
                     WHERE c.id = ?
                    """, String.class, me);
            return names.isEmpty() || names.get(0) == null ? "a workspace member" : names.get(0);
        } catch (RuntimeException e) {
            return "a workspace member";
        }
    }

    /** Keeps only short scalar filter values, so the log stays a log. */
    private static Map<String, Object> sanitize(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        in.entrySet().stream().limit(20).forEach(e -> {
            Object v = e.getValue();
            if (e.getKey() == null || e.getKey().length() > 40) return;
            if (v == null || v instanceof Number || v instanceof Boolean) out.put(e.getKey(), v);
            else if (v instanceof String s) out.put(e.getKey(), s.length() > 120 ? s.substring(0, 120) : s);
        });
        return out;
    }
}
