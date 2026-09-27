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
 * My expense claims: the rows of {@code GET /v1/expense/my}
 * ({@code hrms.expense.claim.self}; expenses sit in the hrms module). Drafts are
 * left out: they haven't been sent. Steps: sent, approved, paid.
 */
@Component
class ExpenseClaimsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;

    ExpenseClaimsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "EXPENSE"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.expense.claim.self"); }

    record Row(UUID id, String title, BigDecimal amount, String currency, String status, Instant createdAt,
               Instant submittedAt, Instant decidedAt, Instant reimbursedAt, String approverName) {}

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        return jdbc.query("""
                SELECT x.id, x.title, x.total_amount, x.currency, x.status, x.created_at, x.submitted_at,
                       x.approved_at, x.reimbursed_at,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name
                  FROM expense_mgmt.expense_claims x
                  LEFT JOIN hrms.employees a ON a.id = x.approver_id AND a.tenant_id = x.tenant_id
                 WHERE x.tenant_id = ? AND x.employee_id = ? AND x.status <> 'DRAFT'
                 ORDER BY (x.status = 'SUBMITTED') DESC, COALESCE(x.submitted_at, x.created_at) DESC
                 LIMIT ?
                """, (rs, i) -> toRequest(new Row(rs.getObject("id", UUID.class), rs.getString("title"),
                        rs.getBigDecimal("total_amount"), rs.getString("currency"), rs.getString("status"),
                        Rows.instant(rs, "created_at"), Rows.instant(rs, "submitted_at"),
                        Rows.instant(rs, "approved_at"), Rows.instant(rs, "reimbursed_at"), rs.getString("approver_name"))),
                caller.tenantId(), caller.employeeId(), limit);
    }

    static MyRequest toRequest(Row r) {
        String status = r.status() == null ? "" : r.status();
        Instant sent = r.submittedAt() != null ? r.submittedAt() : r.createdAt();
        Steps steps = new Steps().done("Sent", null, sent);
        String state, label, waiting = null, decidedBy = null;
        switch (status) {
            case "SUBMITTED" -> {
                steps.current("Approval", r.approverName()).todo("Paid");
                state = "WAITING";
                label = "Waiting";
                waiting = r.approverName();
            }
            case "APPROVED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).todo("Paid");
                state = "APPROVED";
                label = "Approved";
                decidedBy = r.approverName();
            }
            case "APPROVED_FOR_PAY" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).current("Paid", null);
                state = "APPROVED";
                label = "Being paid";
                decidedBy = r.approverName();
            }
            case "REIMBURSED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).done("Paid", null, r.reimbursedAt());
                state = "DONE";
                label = "Reimbursed";
                decidedBy = r.approverName();
            }
            case "REJECTED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt()).skipped("Paid");
                state = "REJECTED";
                label = "Rejected";
                decidedBy = r.approverName();
            }
            default -> {
                steps.current("Approval", r.approverName()).todo("Paid");
                state = "WAITING";
                label = Rows.pretty(status);
            }
        }
        boolean closed = "DONE".equals(state) || "REJECTED".equals(state);
        String title = r.title() == null || r.title().isBlank() ? "Expense claim" : r.title().trim();
        return new MyRequest("EXPENSE", r.id(), title, null, null, null, r.amount(),
                r.currency() == null ? "INR" : r.currency(), status, state, label, steps.progress(closed), steps.list(),
                waiting, decidedBy, sent, Rows.latest(sent, r.decidedAt(), r.reimbursedAt()), "/hrms/expenses?tab=my");
    }
}
