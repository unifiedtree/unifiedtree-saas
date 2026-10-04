package com.hrms.api.attendance;

import com.hrms.attendance.dto.StaffStatusResponse;
import com.hrms.attendance.dto.TeamDashboardResponse;
import com.hrms.attendance.policy.AttendancePolicyEvaluator;
import com.hrms.attendance.policy.EffectiveDay;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * The day register (V143.53 redesign, BW-19): one day's attendance as a CSV,
 * one row per person on the roll that day, exactly the rows the Muster roll
 * shows for the caller (their team scope, and the department picked): people
 * on their weekly off are listed as such, and a company-wide register lists the
 * person downloading it too, so the file is the same whoever downloads it.
 * Employee, Code, Department, Branch, Shift, In, Out, Hours, Status, Source.
 * Saved as {@code muster-roll-YYYY-MM-DD.csv} and recorded in the export log,
 * so the Reports Center's "Recent downloads" lists it.
 *
 * <p>Who: the attendance report permission ({@code hrms.report.attendance},
 * read from the database) and team attendance ({@code attendance.team.read}),
 * the permission the rows themselves need. Every role holding the first holds
 * the second.
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance register", description = "The day register as a CSV")
@SecurityRequirement(name = "bearerAuth")
public class AttendanceRegisterController {

    private static final Logger log = LoggerFactory.getLogger(AttendanceRegisterController.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm").withZone(IST);
    private static final DateTimeFormatter DAY_HHMM = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(IST);
    static final String REPORT = "muster-roll";
    static final String REPORT_LABEL = "Muster roll";
    static final String HEADER = "Employee,Code,Department,Branch,Shift,In,Out,Hours,Status,Source";

    private final AttendanceController attendance;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate ownTx;

    public AttendanceRegisterController(AttendanceController attendance, JdbcTemplate jdbc, PlatformTransactionManager txm) {
        this.attendance = attendance;
        this.jdbc = jdbc;
        this.ownTx = new TransactionTemplate(txm);
        this.ownTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Operation(summary = "Download one day's attendance register as a CSV (the rows the Muster roll shows you)")
    @GetMapping("/register/export.csv")
    @PreAuthorize("hasAuthority('attendance.team.read') and @perm.check('hrms.report.attendance')")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) LocalDate date,
                                         @RequestParam(required = false) UUID departmentId,
                                         @AuthenticationPrincipal Jwt jwt) {
        LocalDate day = date != null ? date : LocalDate.now(IST);
        TeamDashboardResponse team = attendance.teamDay(jwt, day, departmentId, false, true, true);
        List<StaffStatusResponse> rows = team.staffStatuses() == null ? List.of() : team.staffStatuses();
        byte[] body = ("﻿" + csv(rows, day)).getBytes(StandardCharsets.UTF_8);
        String fileName = "muster-roll-" + day + ".csv";
        recordExport(jwt, fileName, day, departmentId, rows.size(), body.length);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
        headers.setContentDispositionFormData("attachment", fileName);
        headers.setContentLength(body.length);
        return new ResponseEntity<>(body, headers, HttpStatus.OK);
    }

    // ── the file (package-visible for tests) ─────────────────────────────────

    static String csv(List<StaffStatusResponse> rows, LocalDate day) {
        StringBuilder out = new StringBuilder(HEADER).append("\r\n");
        for (StaffStatusResponse r : rows) {
            out.append(String.join(",",
                    cell(r.fullName()), cell(r.employeeCode()), cell(r.departmentName()), cell(r.branchName()),
                    cell(r.shiftName()), cell(time(r.checkInAt(), day)), cell(time(r.checkOutAt(), day)),
                    cell(hours(r)), cell(status(r)), cell(source(r))))
               .append("\r\n");
        }
        return out.toString();
    }

    /** IST "HH:mm", with the date when it falls on another day (a night shift's check-out). */
    static String time(Instant at, LocalDate day) {
        if (at == null) return null;
        return at.atZone(IST).toLocalDate().equals(day) ? HHMM.format(at) : DAY_HHMM.format(at);
    }

    /** Hours worked, check-in to check-out, as a decimal ("8.50"); empty while still in. */
    static String hours(StaffStatusResponse r) {
        Integer minutes = r.workedMinutes();
        if (minutes == null && r.checkInAt() != null && r.checkOutAt() != null && !r.checkOutAt().isBefore(r.checkInAt())) {
            minutes = (int) java.time.Duration.between(r.checkInAt(), r.checkOutAt()).toMinutes();
        }
        return minutes == null ? null : String.format(java.util.Locale.ROOT, "%.2f", minutes / 60.0);
    }

    /** The day's status in words; work from home is said when the day was worked from home. */
    static String status(StaffStatusResponse r) {
        String s = r.effectiveStatus() != null ? AttendancePolicyEvaluator.label(r.effectiveStatus()) : legacyLabel(r.status());
        boolean worked = EffectiveDay.PRESENT.equals(r.effectiveStatus()) || EffectiveDay.LATE.equals(r.effectiveStatus())
                || EffectiveDay.HALF_DAY.equals(r.effectiveStatus());
        return worked && "WFH".equals(r.attendanceType()) ? s + " (work from home)" : s;
    }

    /** How the day was recorded: the check-in method, or the leave type for a day on leave. */
    static String source(StaffStatusResponse r) {
        if (r.checkInMethod() != null) return methodLabel(r.checkInMethod());
        if (r.onLeave()) return r.leaveTypeName() != null ? r.leaveTypeName() : "Leave";
        return null;
    }

    static String methodLabel(String method) {
        return switch (method) {
            case "FACE_RECOGNITION" -> "Face";
            case "GPS", "MOBILE_GPS", "GEO_FENCE" -> "Mobile (GPS)";
            case "WEB" -> "Web";
            case "PIN" -> "PIN";
            case "KIOSK" -> "Kiosk";
            case "BIOMETRIC_DEVICE", "BIOMETRIC_FINGERPRINT" -> "Biometric device";
            case "MANAGER_OVERRIDE" -> "Added by HR";
            case "MANUAL" -> "Manual";
            case "API" -> "API";
            default -> method;
        };
    }

    private static String legacyLabel(String status) {
        if (status == null) return null;
        return switch (status) {
            case "ON_TIME", "PRESENT" -> "Present";
            case "LATE" -> "Late";
            case "HALF_DAY" -> "Half day";
            case "ABSENT" -> "Absent";
            case "NOT_MARKED" -> "Not marked";
            default -> status;
        };
    }

    /**
     * One CSV field: quoted when it holds a comma, quote or line break, and
     * prefixed with ' when a spreadsheet would read it as a formula.
     */
    static String cell(String raw) {
        if (raw == null) return "";
        String s = raw;
        if (!s.isEmpty() && "=+@\t\r".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        else if (s.length() > 1 && s.charAt(0) == '-' && !Character.isDigit(s.charAt(1))) s = "'" + s;
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    // ── the export log (hrms.report_exports, V143.27) ────────────────────────

    /**
     * One row in the export log, in its own transaction so it commits whatever
     * happens here. A logging failure (for example the table missing) never stops
     * the download.
     */
    private void recordExport(Jwt jwt, String fileName, LocalDate day, UUID departmentId, int rowCount, int size) {
        try {
            UUID tenant = TenantContext.requireTenantId();
            UUID user = TenantContext.getUserId();
            UUID caller = AttendanceReviewService.callerEmployeeId(jwt);
            String filters = "{\"date\":\"" + day + "\"" + (departmentId != null ? ",\"departmentId\":\"" + departmentId + "\"" : "") + "}";
            ownTx.executeWithoutResult(status -> jdbc.update("""
                    INSERT INTO hrms.report_exports (id, tenant_id, user_id, report, report_label, format, source,
                                                     file_name, company_id, company_name, filters, row_count, size_bytes)
                    SELECT gen_random_uuid(), ?, ?, ?, ?, 'CSV', 'SERVER', ?, e.company_id, c.name, ?::jsonb, ?, ?
                      FROM (SELECT 1) one
                      LEFT JOIN hrms.employees e ON e.id = ? AND e.tenant_id = ?
                      LEFT JOIN org.companies c ON c.id = e.company_id
                    """, tenant, user, REPORT, REPORT_LABEL, fileName, filters, rowCount, (long) size, caller, tenant));
        } catch (RuntimeException e) {
            log.warn("The muster roll download ({}) was not recorded in the export log: {}", fileName, e.getMessage());
        }
    }
}
