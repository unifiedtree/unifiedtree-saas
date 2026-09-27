package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * My attendance fixes: the rows of {@code GET /v1/attendance/corrections/my}
 * ({@code attendance.checkin.self}, attendance module).
 */
@Component
class CorrectionRequestsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;
    private final NotifiedApprover notified;

    CorrectionRequestsSource(JdbcTemplate jdbc, NotifiedApprover notified) {
        this.jdbc = jdbc;
        this.notified = notified;
    }

    @Override public String key() { return "CORRECTION"; }
    @Override public String module() { return "attendance"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("attendance.checkin.self"); }

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        List<TwoStepRequests.Row> rows = jdbc.query("""
                SELECT c.id, c.missing_for_date, c.status, c.created_at, c.decision_at, c.approver_id,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name
                  FROM attendance.regularization_requests c
                  LEFT JOIN hrms.employees a ON a.id = c.approver_id AND a.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ? AND c.employee_id = ?
                 ORDER BY (c.status = 'PENDING') DESC, c.created_at DESC
                 LIMIT ?
                """, (rs, i) -> {
                    LocalDate day = rs.getObject("missing_for_date", LocalDate.class);
                    return new TwoStepRequests.Row("CORRECTION", rs.getObject("id", UUID.class), "Attendance fix",
                            day, day, null, rs.getString("status"),
                            Rows.instant(rs, "created_at"), Rows.instant(rs, "decision_at"),
                            rs.getString("approver_name"), rs.getObject("approver_id") != null,
                            "/hrms/attendance?tab=corrections");
                }, caller.tenantId(), caller.employeeId(), limit);
        String waitingFor = rows.stream().anyMatch(r -> "PENDING".equals(r.status()) && !r.hasApprover())
                ? notified.nameFor(caller.employeeId()) : null;
        return rows.stream().map(r -> TwoStepRequests.toRequest(r, waitingFor)).toList();
    }
}
