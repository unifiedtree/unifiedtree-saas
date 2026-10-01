package com.hrms.api.fnf;

import com.hrms.api.advance.PayFinancialYear;
import com.hrms.core.exception.HrmsException;
import com.hrms.fnf.enums.FnfStatus;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Read models over the settlements ledger for the redesign (BW-64): the
 * status of each leaver's most recent settlement (exit lists, a profile) and
 * the ledger's totals. JDBC over existing columns only; every statement
 * filters the tenant and runs in a read-only transaction, so RLS applies too.
 */
@Service
public class FnfReadService {

    /** The most people one status call may ask about (an exit list page is far smaller). */
    static final int MAX_IDS = 200;

    private final JdbcTemplate jdbc;

    public FnfReadService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** One person's most recent settlement, or nulls when none was started. */
    public record FnfStatusRow(UUID employeeId, UUID settlementId, FnfStatus status, LocalDate lastWorkingDay,
                               BigDecimal netSettlement, Instant paidAt) {
        static FnfStatusRow none(UUID employeeId) {
            return new FnfStatusRow(employeeId, null, null, null, null, null);
        }
    }

    /** How many settlements, and their net amount. */
    public record Bucket(long count, BigDecimal amount) {}

    /**
     * The ledger's totals. {@code total} counts every settlement (as the "All"
     * tab does); pending approval = PROCESSED, pending payment = APPROVED,
     * settled = PAID (the page's tabs). Paid this financial year uses the
     * payment date and the caller's company's financial year.
     */
    public record FnfSummary(long total, Bucket pendingApproval, Bucket pendingPayment, Bucket settled,
                             long cancelled, Bucket paidThisFinancialYear, String financialYear,
                             LocalDate financialYearStart, LocalDate financialYearEnd) {}

    /**
     * Parses "a,b,c" into distinct ids in the order given. Blank entries are
     * skipped. A malformed id or too many ids is a 400 with its own code (not
     * INVALID_PARAMETER, which the web reads as "endpoint not built yet").
     */
    static List<UUID> parseIds(String employeeIds) {
        if (employeeIds == null || employeeIds.isBlank()) return List.of();
        LinkedHashSet<UUID> ids = new LinkedHashSet<>();
        for (String part : employeeIds.split(",")) {
            String s = part.trim();
            if (s.isEmpty()) continue;
            try {
                ids.add(UUID.fromString(s));
            } catch (IllegalArgumentException e) {
                throw new HrmsException("“" + s + "” isn’t an employee id.", HttpStatus.BAD_REQUEST, "INVALID_EMPLOYEE_ID");
            }
        }
        if (ids.size() > MAX_IDS) {
            throw new HrmsException("Ask for at most " + MAX_IDS + " people at a time.", HttpStatus.BAD_REQUEST, "TOO_MANY_EMPLOYEES");
        }
        return new ArrayList<>(ids);
    }

    /** One row per id, in the same order: that person's most recent settlement (any status, CANCELLED included). */
    @Transactional(readOnly = true)
    public List<FnfStatusRow> statusFor(UUID tenantId, List<UUID> employeeIds) {
        if (employeeIds.isEmpty()) return List.of();
        String in = String.join(",", Collections.nCopies(employeeIds.size(), "?"));
        List<Object> args = new ArrayList<>(employeeIds.size() + 1);
        args.add(tenantId);
        args.addAll(employeeIds);
        Map<UUID, FnfStatusRow> latest = new HashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (employee_id)
                       employee_id, id, status, last_working_day, net_settlement, paid_at
                  FROM fnf_mgmt.fnf_settlements
                 WHERE tenant_id = ? AND employee_id IN (%s)
                 ORDER BY employee_id, created_at DESC, id DESC
                """.formatted(in), (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID employee = rs.getObject("employee_id", UUID.class);
                    java.sql.Date lwd = rs.getDate("last_working_day");
                    Timestamp paid = rs.getTimestamp("paid_at");
                    latest.put(employee, new FnfStatusRow(employee, rs.getObject("id", UUID.class),
                            FnfStatus.valueOf(rs.getString("status")),
                            lwd == null ? null : lwd.toLocalDate(),
                            rs.getBigDecimal("net_settlement"),
                            paid == null ? null : paid.toInstant()));
                }, args.toArray());
        return employeeIds.stream().map(id -> latest.getOrDefault(id, FnfStatusRow.none(id))).toList();
    }

    @Transactional(readOnly = true)
    public FnfSummary summary(UUID tenantId, PayFinancialYear year) {
        return jdbc.query("""
                SELECT count(*)                                                              AS total,
                       count(*) FILTER (WHERE status = 'PROCESSED')                          AS pa_n,
                       coalesce(sum(net_settlement) FILTER (WHERE status = 'PROCESSED'), 0)  AS pa_amt,
                       count(*) FILTER (WHERE status = 'APPROVED')                           AS pp_n,
                       coalesce(sum(net_settlement) FILTER (WHERE status = 'APPROVED'), 0)   AS pp_amt,
                       count(*) FILTER (WHERE status = 'PAID')                               AS paid_n,
                       coalesce(sum(net_settlement) FILTER (WHERE status = 'PAID'), 0)       AS paid_amt,
                       count(*) FILTER (WHERE status = 'CANCELLED')                          AS cancelled_n,
                       count(*) FILTER (WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?) AS fy_n,
                       coalesce(sum(net_settlement) FILTER (WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?), 0) AS fy_amt
                  FROM fnf_mgmt.fnf_settlements
                 WHERE tenant_id = ?
                """, rs -> {
                    rs.next();
                    return new FnfSummary(rs.getLong("total"),
                            new Bucket(rs.getLong("pa_n"), rs.getBigDecimal("pa_amt")),
                            new Bucket(rs.getLong("pp_n"), rs.getBigDecimal("pp_amt")),
                            new Bucket(rs.getLong("paid_n"), rs.getBigDecimal("paid_amt")),
                            rs.getLong("cancelled_n"),
                            new Bucket(rs.getLong("fy_n"), rs.getBigDecimal("fy_amt")),
                            year.label(), year.start(), year.end());
                }, year.startsAt(), year.endsBefore(), year.startsAt(), year.endsBefore(), tenantId);
    }
}
