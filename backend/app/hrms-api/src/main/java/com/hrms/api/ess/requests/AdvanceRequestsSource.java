package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * My salary advances: the rows of {@code GET /v1/advance/my}
 * ({@code hrms.advance.request.self}; advances sit in the hrms module),
 * including ones HR raised for me. Steps: sent, approved, paid out, repaid.
 */
@Component
class AdvanceRequestsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;

    AdvanceRequestsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "ADVANCE"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.advance.request.self"); }

    /** {@code closedAt}: when it was repaid; not recorded today, so null (the step shows no date). */
    record Row(UUID id, BigDecimal amount, String status, Instant createdAt, Instant decidedAt,
               Instant disbursedAt, Instant closedAt, String approverName) {}

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        return jdbc.query("""
                SELECT v.id, v.amount, v.status, v.created_at, v.approved_at, v.disbursed_at,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name
                  FROM advance_mgmt.advance_requests v
                  LEFT JOIN hrms.employees a ON a.id = v.approver_id AND a.tenant_id = v.tenant_id
                 WHERE v.tenant_id = ? AND v.employee_id = ?
                 ORDER BY (v.status = 'REQUESTED') DESC, v.created_at DESC
                 LIMIT ?
                """, (rs, i) -> {
                    String status = rs.getString("status");
                    return toRequest(new Row(rs.getObject("id", UUID.class), rs.getBigDecimal("amount"), status,
                            Rows.instant(rs, "created_at"), Rows.instant(rs, "approved_at"), Rows.instant(rs, "disbursed_at"),
                            null, rs.getString("approver_name")));
                }, caller.tenantId(), caller.employeeId(), limit);
    }

    static MyRequest toRequest(Row r) {
        String status = r.status() == null ? "" : r.status();
        Steps steps = new Steps().done("Sent", null, r.createdAt());
        String state, label, waiting = null, decidedBy = null;
        switch (status) {
            case "REQUESTED" -> {
                steps.current("Approval", r.approverName()).todo("Paid out").todo("Repaid");
                state = "WAITING";
                label = "Waiting";
                waiting = r.approverName();
            }
            case "APPROVED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).current("Paid out", null).todo("Repaid");
                state = "APPROVED";
                label = "Approved";
                decidedBy = r.approverName();
            }
            case "DISBURSED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).done("Paid out", null, r.disbursedAt())
                        .current("Repaid", null);
                state = "APPROVED";
                label = "Paid out";
                decidedBy = r.approverName();
            }
            case "CLOSED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).done("Paid out", null, r.disbursedAt())
                        .done("Repaid", null, r.closedAt());
                state = "DONE";
                label = "Repaid";
                decidedBy = r.approverName();
            }
            case "REJECTED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).skipped("Paid out").skipped("Repaid");
                state = "REJECTED";
                label = "Rejected";
                decidedBy = r.approverName();
            }
            default -> {
                steps.current("Approval", r.approverName()).todo("Paid out").todo("Repaid");
                state = "WAITING";
                label = Rows.pretty(status);
            }
        }
        boolean closed = "DONE".equals(state) || "REJECTED".equals(state);
        return new MyRequest("ADVANCE", r.id(), "Salary advance", null, null, null, r.amount(), "INR",
                status, state, label, steps.progress(closed), steps.list(), waiting, decidedBy, r.createdAt(),
                Rows.latest(r.createdAt(), r.decidedAt(), r.disbursedAt(), r.closedAt()), "/hrms/advances?tab=my");
    }
}
