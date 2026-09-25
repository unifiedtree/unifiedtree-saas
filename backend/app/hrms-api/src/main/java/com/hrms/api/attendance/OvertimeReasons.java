package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

/**
 * Why an employee worked past their shift (attendance.records.overtime_reason,
 * V143.25). Two ways in:
 * <ul>
 *   <li>the mobile app sends {@code overtimeReason} with the check-out
 *       ({@link #recordAtCheckout}); a note on a punch never fails the punch,
 *       so longer text is cut at {@value #MAX} characters;</li>
 *   <li>the employee explains it afterwards, while the overtime is still
 *       waiting for a decision ({@link #setByEmployee}).</li>
 * </ul>
 * The overtime list returns it next to the shift end and the check-out time.
 * Read and written with JDBC only; the JPA entity does not map the column.
 */
@Component
public class OvertimeReasons {

    private static final Logger log = LoggerFactory.getLogger(OvertimeReasons.class);

    /** Column width of attendance.records.overtime_reason. */
    static final int MAX = 500;
    /** Shortest reason the employee may type ("Audit" is fine, "ok" is not). */
    static final int MIN = 3;

    private final JdbcTemplate jdbc;

    public OvertimeReasons(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Trims the text, turns line breaks, tabs and other control characters into
     * spaces and collapses runs of spaces. Null when nothing is left.
     */
    static String normalize(String raw) {
        if (raw == null) return null;
        String s = raw.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
        return s.isEmpty() ? null : s;
    }

    /** The reason as stored at check-out: normalized and cut to the column width. Null when blank. */
    static String forCheckout(String raw) {
        String s = normalize(raw);
        if (s == null) return null;
        return s.length() > MAX ? s.substring(0, MAX) : s;
    }

    /**
     * Stores the reason sent with a check-out on that record. Best effort: a
     * failure is logged and swallowed, because the punch itself has already
     * been saved and must not be reported as failed.
     */
    @Transactional
    public void recordAtCheckout(UUID recordId, UUID employeeId, String raw) {
        String reason = forCheckout(raw);
        if (reason == null || recordId == null || employeeId == null) return;
        try {
            jdbc.update("UPDATE attendance.records SET overtime_reason = ? WHERE id = ? AND employee_id = ? AND tenant_id = ?",
                    reason, recordId, employeeId, TenantContext.requireTenantId());
        } catch (RuntimeException ex) {
            log.warn("Could not store the overtime reason for record {}: {}", recordId, ex.getMessage());
        }
    }

    /**
     * The employee gives (or changes) the reason for their own overtime. Refused
     * once a decision has been recorded for the current minutes, so the reason
     * an approver saw is the one on file.
     */
    @Transactional
    public Map<String, Object> setByEmployee(UUID recordId, UUID employeeId, String raw) {
        String reason = normalize(raw);
        if (reason == null || reason.length() < MIN) {
            throw new BusinessRuleException("Say why you worked past your shift (at least " + MIN + " characters).",
                    "OVERTIME_REASON_REQUIRED");
        }
        if (reason.length() > MAX) {
            throw new BusinessRuleException("Keep the reason under " + MAX + " characters.", "OVERTIME_REASON_TOO_LONG");
        }
        UUID tenant = TenantContext.requireTenantId();
        var rows = jdbc.queryForList(
                "SELECT employee_id, overtime_minutes FROM attendance.records WHERE id = ? AND tenant_id = ? "
                        + "AND overtime_minutes > 0 AND check_out_at IS NOT NULL FOR UPDATE",
                recordId, tenant);
        if (rows.isEmpty()) {
            throw new BusinessRuleException("Completed overtime record not found", "OVERTIME_NOT_FOUND");
        }
        if (!employeeId.equals(rows.getFirst().get("employee_id"))) {
            throw new AccessDeniedException("You can only explain your own overtime.");
        }
        int minutes = ((Number) rows.getFirst().get("overtime_minutes")).intValue();
        Integer decided = jdbc.queryForObject(
                "SELECT count(*) FROM attendance.overtime_decisions WHERE tenant_id = ? AND record_id = ? AND reviewed_minutes = ?",
                Integer.class, tenant, recordId, minutes);
        if (decided != null && decided > 0) {
            throw new BusinessRuleException("This overtime has already been reviewed", "OVERTIME_ALREADY_REVIEWED");
        }
        jdbc.update("UPDATE attendance.records SET overtime_reason = ? WHERE id = ? AND tenant_id = ?", reason, recordId, tenant);
        return Map.of("id", recordId, "reason", reason);
    }
}
