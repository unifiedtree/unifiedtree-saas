package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * My leave requests: the rows of {@code GET /v1/leave/my} (the same permission,
 * {@code leave.balance.read}, and the leave module), with who has or decided each.
 * A request waits for its approver; a two-level one then waits for HR.
 */
@Component
class LeaveRequestsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;

    LeaveRequestsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "LEAVE"; }
    @Override public String module() { return "leave"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("leave.balance.read"); }

    record Row(UUID id, String typeName, LocalDate start, LocalDate end, double totalDays, String status,
               Instant createdAt, Instant decisionAt, Instant cancelledAt, Instant l2At, UUID l2ApproverId,
               String approverName, String l2Name) {}

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        return jdbc.query("""
                SELECT r.id, t.name AS type_name, r.start_date, r.end_date, r.total_days, r.status,
                       r.created_at, r.decision_at, r.cancelled_at, r.l2_approved_at, r.l2_approver_id,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name,
                       NULLIF(TRIM(CONCAT_WS(' ', h.first_name, h.last_name)), '') AS l2_name
                  FROM leave_mgmt.leave_requests r
                  LEFT JOIN leave_mgmt.leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
                  LEFT JOIN hrms.employees a ON a.id = r.approver_id AND a.tenant_id = r.tenant_id
                  LEFT JOIN hrms.employees h ON h.id = r.l2_approver_id AND h.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.employee_id = ?
                 ORDER BY (r.status IN ('PENDING', 'PENDING_L2', 'ESCALATED')) DESC, r.created_at DESC
                 LIMIT ?
                """, (rs, i) -> toRequest(row(rs)), caller.tenantId(), caller.employeeId(), limit);
    }

    private static Row row(ResultSet rs) throws SQLException {
        return new Row(rs.getObject("id", UUID.class), rs.getString("type_name"),
                rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                rs.getDouble("total_days"), rs.getString("status"),
                Rows.instant(rs, "created_at"), Rows.instant(rs, "decision_at"), Rows.instant(rs, "cancelled_at"),
                Rows.instant(rs, "l2_approved_at"), rs.getObject("l2_approver_id", UUID.class),
                rs.getString("approver_name"), rs.getString("l2_name"));
    }

    static MyRequest toRequest(Row r) {
        String status = r.status() == null ? "" : r.status();
        Steps steps = new Steps().done("Sent", null, r.createdAt());
        String state, label, waitingFor = null, decidedBy = null;
        Instant last = r.createdAt();
        boolean hr = r.l2ApproverId() != null;
        switch (status) {
            case "PENDING", "ESCALATED" -> {
                steps.current("Approval", r.approverName());
                state = "WAITING";
                label = "PENDING".equals(status) ? "Waiting" : "Escalated";
                waitingFor = r.approverName();
            }
            case "PENDING_L2" -> {
                steps.done("Approval", r.approverName(), r.decisionAt()).current("HR approval", null);
                state = "WAITING";
                label = "Waiting for HR";
                last = Rows.latest(r.createdAt(), r.decisionAt());
            }
            case "APPROVED", "REJECTED" -> {
                steps.done("Approval", r.approverName(), r.decisionAt());
                if (hr) steps.done("HR approval", r.l2Name(), r.l2At());
                state = status;
                label = "APPROVED".equals(status) ? "Approved" : "Rejected";
                decidedBy = hr ? r.l2Name() : r.approverName();
                last = Rows.latest(r.createdAt(), r.decisionAt(), r.l2At());
            }
            case "CANCELLED" -> {
                if (r.decisionAt() != null) steps.done("Approval", r.approverName(), r.decisionAt());
                else steps.skipped("Approval");
                state = "CANCELLED";
                label = "Cancelled";
                last = Rows.latest(r.createdAt(), r.decisionAt(), r.cancelledAt());
            }
            default -> {
                steps.current("Approval", r.approverName());
                state = "WAITING";
                label = Rows.pretty(status);
            }
        }
        boolean closed = !"WAITING".equals(state);
        String title = r.typeName() == null || r.typeName().isBlank() ? "Leave" : r.typeName().trim();
        return new MyRequest("LEAVE", r.id(), title, r.start(), r.end(), r.totalDays(), null, null,
                status, state, label, steps.progress(closed), steps.list(), waitingFor, decidedBy,
                r.createdAt(), last, "/hrms/leave?tab=my");
    }
}
