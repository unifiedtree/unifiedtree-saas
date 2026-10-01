package com.hrms.api.leave;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.LeaveRequestResponse.LeaveConflict;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The details a leave request row shows in the redesign (BW-38), looked up for
 * a whole page at once: the leave type's code and category, the requester's
 * balance, who it went to, who decided and when, who applied when it was
 * applied on the employee's behalf, and, on the approvers' queues, what to
 * check before deciding.
 *
 * <p>Additive only: a failed lookup leaves these fields null and the rows are
 * returned as they were (the mobile app reads the same endpoints).
 *
 * <p>Who applied: {@code leave_requests.created_by} is the signed-in account
 * that saved the row (JPA auditing). When that account belongs to someone other
 * than the requester, the leave was applied for them (POST /apply/for/{id}).
 */
@Component
public class LeaveRequestDetails {

    private static final Logger log = LoggerFactory.getLogger(LeaveRequestDetails.class);
    /** Colleagues who have left don't count as "also away". */
    private static final String STILL_HERE = "oe.employment_status NOT IN ('EXITED','TERMINATED','RESIGNED','RETIRED')";

    private final JdbcTemplate jdbc;

    public LeaveRequestDetails(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Found(String typeCode, String typeCategory, Double available, Double total, String approver,
                         String l2Approver, String raisedBy, Timestamp decisionAt, Timestamp l2At, String requesterStatus) {}

    /**
     * The rows with their details filled in, in the same order.
     *
     * @param withConflicts add {@code conflicts} to the waiting rows (approvers' queues only: it names colleagues)
     */
    public List<LeaveRequestResponse> apply(List<LeaveRequestResponse> rows, boolean withConflicts) {
        if (rows == null || rows.isEmpty()) return rows;
        List<UUID> ids = rows.stream().map(LeaveRequestResponse::id).filter(Objects::nonNull).distinct().toList();
        UUID tenantId = TenantContext.getTenantId();
        if (ids.isEmpty() || tenantId == null) return rows;
        Map<UUID, Found> found;
        Map<UUID, List<String>> overlaps = Map.of();
        try {
            found = lookup(tenantId, ids);
            if (withConflicts) {
                List<UUID> waiting = rows.stream().filter(r -> r.id() != null && waiting(r.status()))
                        .map(LeaveRequestResponse::id).distinct().toList();
                if (!waiting.isEmpty()) overlaps = overlaps(tenantId, waiting);
            }
        } catch (DataAccessException e) {
            log.warn("Leave request details unavailable, returning the rows without them: {}", e.getMessage());
            return rows;
        }
        List<LeaveRequestResponse> out = new ArrayList<>(rows.size());
        for (LeaveRequestResponse r : rows) {
            Found f = r.id() == null ? null : found.get(r.id());
            if (f == null) { out.add(r); continue; }
            String decidedBy = f.l2At() != null ? f.l2Approver() : f.decisionAt() != null ? f.approver() : null;
            List<LeaveConflict> checks = null;
            if (withConflicts && waiting(r.status())) {
                checks = conflicts(overlaps.getOrDefault(r.id(), List.of()), "NOTICE_PERIOD".equals(f.requesterStatus()));
            }
            out.add(r.withDetails(f.typeCode(), f.typeCategory(), f.available(), f.total(), f.approver(), decidedBy,
                    f.l2Approver(), f.raisedBy(), checks));
        }
        return out;
    }

    /** Still waiting for a decision (the first or the second level). */
    static boolean waiting(ApprovalStatus status) {
        return status == ApprovalStatus.PENDING || status == ApprovalStatus.PENDING_L2;
    }

    /** One row: {@link #apply(List, boolean)} for a list of one. */
    public LeaveRequestResponse applyOne(LeaveRequestResponse row, boolean withConflicts) {
        if (row == null) return null;
        return apply(List.of(row), withConflicts).get(0);
    }

    private Map<UUID, Found> lookup(UUID tenantId, List<UUID> ids) {
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        args.addAll(ids);
        Map<UUID, Found> out = new HashMap<>();
        jdbc.query("""
                SELECT lr.id, lt.code AS type_code, lt.category AS type_category,
                       CAST(b.total_entitlement + b.carry_forward - b.used - b.pending AS double precision) AS bal_available,
                       CAST(b.total_entitlement + b.carry_forward AS double precision) AS bal_total,
                       NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), '') AS approver_name,
                       NULLIF(TRIM(COALESCE(h.first_name, '') || ' ' || COALESCE(h.last_name, '')), '') AS l2_name,
                       NULLIF(TRIM(COALESCE(rb.first_name, '') || ' ' || COALESCE(rb.last_name, '')), '') AS raised_by_name,
                       lr.decision_at, lr.l2_approved_at, e.employment_status AS requester_status
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
                  LEFT JOIN leave_mgmt.leave_balances b
                         ON b.employee_id = lr.employee_id AND b.leave_type_id = lr.leave_type_id
                        AND b.year = CAST(EXTRACT(YEAR FROM lr.start_date) AS integer)
                  LEFT JOIN hrms.employees a ON a.id = lr.approver_id
                  LEFT JOIN hrms.employees h ON h.id = lr.l2_approver_id
                  LEFT JOIN auth.user_credentials uc ON uc.id::text = lr.created_by
                  LEFT JOIN hrms.employees rb ON rb.id = uc.employee_id AND uc.employee_id <> lr.employee_id
                  LEFT JOIN hrms.employees e ON e.id = lr.employee_id
                 WHERE lr.tenant_id = ? AND lr.id IN (%s)
                """.formatted(in), rs -> {
            double available = rs.getDouble("bal_available");
            Double availableOrNull = rs.wasNull() ? null : available;
            double total = rs.getDouble("bal_total");
            Double totalOrNull = rs.wasNull() ? null : total;
            out.put(rs.getObject("id", UUID.class), new Found(rs.getString("type_code"), rs.getString("type_category"),
                    availableOrNull, totalOrNull, rs.getString("approver_name"), rs.getString("l2_name"),
                    rs.getString("raised_by_name"), rs.getTimestamp("decision_at"), rs.getTimestamp("l2_approved_at"),
                    rs.getString("requester_status")));
        }, args.toArray());
        return out;
    }

    /** First names of same-department colleagues who are away, or asked to be, on some of each request's days. */
    private Map<UUID, List<String>> overlaps(UUID tenantId, List<UUID> ids) {
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        args.addAll(ids);
        Map<UUID, Map<UUID, String>> byRequest = new LinkedHashMap<>();
        jdbc.query("""
                SELECT DISTINCT lr.id AS request_id, oe.id AS other_id, TRIM(COALESCE(oe.first_name, '')) AS first_name
                  FROM leave_mgmt.leave_requests lr
                  JOIN hrms.employees e  ON e.id = lr.employee_id AND e.department_id IS NOT NULL
                  JOIN hrms.employees oe ON oe.department_id = e.department_id AND oe.id <> lr.employee_id
                  JOIN leave_mgmt.leave_requests o
                         ON o.employee_id = oe.id
                        AND o.status IN ('APPROVED', 'PENDING', 'PENDING_L2')
                        AND o.start_date <= lr.end_date AND o.end_date >= lr.start_date
                 WHERE lr.tenant_id = ? AND lr.id IN (%s) AND %s
                 ORDER BY first_name
                """.formatted(in, STILL_HERE), rs -> {
            String name = rs.getString("first_name");
            if (name == null || name.isBlank()) return;
            byRequest.computeIfAbsent(rs.getObject("request_id", UUID.class), k -> new LinkedHashMap<>())
                    .put(rs.getObject("other_id", UUID.class), name);
        }, args.toArray());
        Map<UUID, List<String>> out = new HashMap<>();
        byRequest.forEach((id, people) -> out.put(id, new ArrayList<>(people.values())));
        return out;
    }

    /** The checks for one waiting request, in the order they are shown. */
    static List<LeaveConflict> conflicts(List<String> awayNames, boolean onNotice) {
        List<LeaveConflict> out = new ArrayList<>();
        if (awayNames != null && !awayNames.isEmpty()) {
            out.add(new LeaveConflict("TEAM_OVERLAP", "Also away on some of these days: " + nameList(awayNames),
                    List.copyOf(awayNames)));
        }
        if (onNotice) out.add(new LeaveConflict("ON_NOTICE", "Serving their notice period", List.of()));
        return out;
    }

    /** "Asha", "Asha and Ravi", "Asha, Ravi and Kiran", "Asha, Ravi, Kiran and 2 more". */
    static String nameList(List<String> names) {
        int n = names.size();
        if (n == 1) return names.get(0);
        if (n <= 3) return String.join(", ", names.subList(0, n - 1)) + " and " + names.get(n - 1);
        return String.join(", ", names.subList(0, 3)) + " and " + (n - 3) + " more";
    }
}
