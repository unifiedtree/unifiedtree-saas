package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * My shift changes: the rows of {@code GET /v1/shifts/change-requests/my}
 * ({@code attendance.checkin.self}, attendance module). The day shown is the
 * day it started (once approved) or the day asked for.
 */
@Component
class ShiftChangeRequestsSource implements MyRequestSource {

    private final JdbcTemplate jdbc;
    private final NotifiedApprover notified;

    ShiftChangeRequestsSource(JdbcTemplate jdbc, NotifiedApprover notified) {
        this.jdbc = jdbc;
        this.notified = notified;
    }

    @Override public String key() { return "SHIFT_CHANGE"; }
    @Override public String module() { return "attendance"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("attendance.checkin.self"); }

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        List<TwoStepRequests.Row> rows = jdbc.query("""
                SELECT s.id, s.status, s.created_at, s.decided_at, s.approver_id,
                       COALESCE(s.applied_effective_date, s.requested_effective_date) AS starts_on,
                       p.name AS shift_name,
                       NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approver_name
                  FROM attendance.shift_change_requests s
                  LEFT JOIN attendance.shift_policies p ON p.id = s.requested_shift_policy_id AND p.tenant_id = s.tenant_id
                  LEFT JOIN hrms.employees a ON a.id = s.approver_id AND a.tenant_id = s.tenant_id
                 WHERE s.tenant_id = ? AND s.employee_id = ?
                 ORDER BY (s.status = 'PENDING') DESC, s.created_at DESC
                 LIMIT ?
                """, (rs, i) -> {
                    String shift = rs.getString("shift_name");
                    LocalDate starts = rs.getObject("starts_on", LocalDate.class);
                    return new TwoStepRequests.Row("SHIFT_CHANGE", rs.getObject("id", UUID.class),
                            shift == null || shift.isBlank() ? "Shift change" : "Shift change to " + shift.trim(),
                            starts, null, null, rs.getString("status"),
                            Rows.instant(rs, "created_at"), Rows.instant(rs, "decided_at"),
                            rs.getString("approver_name"), rs.getObject("approver_id") != null, "/me/shift-change");
                }, caller.tenantId(), caller.employeeId(), limit);
        String waitingFor = rows.stream().anyMatch(r -> "PENDING".equals(r.status()) && !r.hasApprover())
                ? notified.nameFor(caller.employeeId()) : null;
        return rows.stream().map(r -> TwoStepRequests.toRequest(r, waitingFor)).toList();
    }
}
