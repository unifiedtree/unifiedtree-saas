package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * My own self-review, not yet submitted, in a review cycle that is still active
 * (a closed cycle turns it into MISSED). The rows of {@code GET /v1/performance/reviews/my}
 * ({@code hrms.performance.review.self}); hrms module. Review due dates come
 * with the review-cycle milestones (BW-78) and join this item then.
 */
@Component
class SelfReviewSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    SelfReviewSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "SELF_REVIEW"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.performance.review.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return jdbc.query("""
                SELECT r.id, c.name AS cycle_name
                  FROM performance_mgmt.performance_reviews r
                  JOIN performance_mgmt.review_cycles c ON c.id = r.cycle_id AND c.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.employee_id = ? AND r.reviewer_id = r.employee_id
                   AND r.status IN ('PENDING', 'IN_PROGRESS') AND c.status = 'ACTIVE'
                 ORDER BY c.period_end NULLS LAST, r.created_at
                """, (rs, i) -> new NeedsYouItem("SELF_REVIEW", "Write your self-review", rs.getString("cycle_name"),
                        null, null, NeedsYouItem.BLUE, rs.getObject("id", UUID.class), 1, "/hrms/performance?view=my-reviews"),
                caller.tenantId(), caller.employeeId());
    }
}
