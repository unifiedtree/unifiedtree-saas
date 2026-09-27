package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * My work-from-home requests: the rows of {@code GET /v1/wfh/my}
 * ({@code wfh.request.self}, attendance module). A waiting request is with the
 * approver it was sent to; afterwards the approver column holds who decided.
 */
@Component
class WfhRequestsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;

    WfhRequestsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "WFH"; }
    @Override public String module() { return "attendance"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("wfh.request.self"); }

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        return jdbc.query("""
                SELECT w.id, w.from_date, w.to_date, w.status, w.created_at, w.decided_at, w.approver_id,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name
                  FROM leave_mgmt.wfh_requests w
                  LEFT JOIN hrms.employees a ON a.id = w.approver_id AND a.tenant_id = w.tenant_id
                 WHERE w.tenant_id = ? AND w.employee_id = ?
                 ORDER BY (w.status = 'PENDING') DESC, w.created_at DESC
                 LIMIT ?
                """, (rs, i) -> {
                    LocalDate from = rs.getObject("from_date", LocalDate.class);
                    LocalDate to = rs.getObject("to_date", LocalDate.class);
                    Double days = from == null || to == null ? null : (double) (ChronoUnit.DAYS.between(from, to) + 1);
                    return TwoStepRequests.toRequest(new TwoStepRequests.Row("WFH", rs.getObject("id", UUID.class),
                            "Work from home", from, to, days, rs.getString("status"),
                            Rows.instant(rs, "created_at"), Rows.instant(rs, "decided_at"),
                            rs.getString("approver_name"), rs.getObject("approver_id") != null, "/me/wfh"), null);
                }, caller.tenantId(), caller.employeeId(), limit);
    }
}
