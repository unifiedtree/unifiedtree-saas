package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Interviews I took that still need my scorecard: the "N scorecards waiting"
 * of today's My workspace, with the same rules as {@code GET /v1/hiring/interviews/mine}
 * (scheduled, from the last 60 days, me on the panel) and the scorecard rule
 * (it can be sent once the interview has started). Needs
 * {@code hrms.hiring.interview.self} or {@code hrms.hiring.read}; hrms module.
 */
@Component
class InterviewScorecardsSource implements NeedsYouSource {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    InterviewScorecardsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "INTERVIEW_SCORECARD"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.hasAny("hrms.hiring.interview.self", "hrms.hiring.read"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return jdbc.query("""
                SELECT i.id, i.title, i.scheduled_at, c.full_name, r.title AS role_title
                  FROM hiring_mgmt.interviews i
                  JOIN hiring_mgmt.interview_interviewers x
                    ON x.tenant_id = i.tenant_id AND x.interview_id = i.id AND x.employee_id = ?
                  JOIN hiring_mgmt.candidates c ON c.id = i.candidate_id AND c.tenant_id = i.tenant_id
                  LEFT JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                 WHERE i.tenant_id = ? AND i.status = 'SCHEDULED'
                   AND i.scheduled_at >= now() - interval '60 days' AND i.scheduled_at <= now()
                   AND NOT EXISTS (SELECT 1 FROM hiring_mgmt.interview_scorecards s
                                    WHERE s.tenant_id = i.tenant_id AND s.interview_id = i.id AND s.interviewer_id = ?)
                 ORDER BY i.scheduled_at
                """, (rs, n) -> {
                    Instant at = Rows.instant(rs, "scheduled_at");
                    LocalDate on = at == null ? null : at.atZone(IST).toLocalDate();
                    String who = rs.getString("full_name");
                    String role = rs.getString("role_title");
                    String title = rs.getString("title");
                    return new NeedsYouItem("INTERVIEW_SCORECARD",
                            "Send your scorecard for " + (who == null || who.isBlank() ? "the candidate" : who.trim()),
                            joinNonBlank(role, title), on, null, NeedsYouItem.BLUE, rs.getObject("id", UUID.class), 1,
                            "/me/interviews");
                }, caller.employeeId(), caller.tenantId(), caller.employeeId());
    }

    private static String joinNonBlank(String a, String b) {
        boolean hasA = a != null && !a.isBlank(), hasB = b != null && !b.isBlank();
        if (hasA && hasB && !a.trim().equalsIgnoreCase(b.trim())) return a.trim() + " · " + b.trim();
        return hasA ? a.trim() : hasB ? b.trim() : null;
    }
}
