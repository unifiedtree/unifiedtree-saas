package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reviews I have to write about other people (as their manager, or a peer),
 * not yet submitted, in an active cycle: one row per cycle ("Write 3 reviews").
 * They are among the rows of {@code GET /v1/performance/reviews/my}, which lists
 * reviews by me as well as about me ({@code hrms.performance.review.self}); hrms module.
 */
@Component
class ReviewsToWriteSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    ReviewsToWriteSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "REVIEWS_TO_WRITE"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.performance.review.self"); }

    private record Row(UUID cycleId, String cycleName, String person) {}

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        List<Row> rows = jdbc.query("""
                SELECT c.id AS cycle_id, c.name AS cycle_name,
                       NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), '') AS person
                  FROM performance_mgmt.performance_reviews r
                  JOIN performance_mgmt.review_cycles c ON c.id = r.cycle_id AND c.tenant_id = r.tenant_id
                  LEFT JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.reviewer_id = ? AND r.employee_id <> r.reviewer_id
                   AND r.status IN ('PENDING', 'IN_PROGRESS') AND c.status = 'ACTIVE'
                 ORDER BY c.period_end NULLS LAST, c.name, person
                """, (rs, i) -> new Row(rs.getObject("cycle_id", UUID.class), rs.getString("cycle_name"), rs.getString("person")),
                caller.tenantId(), caller.employeeId());
        Map<UUID, List<Row>> byCycle = new LinkedHashMap<>();
        for (Row r : rows) byCycle.computeIfAbsent(r.cycleId(), k -> new ArrayList<>()).add(r);
        List<NeedsYouItem> out = new ArrayList<>();
        byCycle.forEach((cycle, list) -> {
            int n = list.size();
            List<String> names = list.stream().map(Row::person).filter(p -> p != null && !p.isBlank()).toList();
            String who = names.isEmpty() ? null : names.size() <= 2 ? String.join(" and ", names)
                    : names.get(0) + ", " + names.get(1) + " and " + (names.size() - 2) + " more";
            String cycleName = list.get(0).cycleName();
            out.add(new NeedsYouItem("REVIEWS_TO_WRITE", n == 1 ? "Write 1 review" : "Write " + n + " reviews",
                    who == null ? cycleName : cycleName == null ? who : cycleName + " · " + who,
                    null, null, NeedsYouItem.BLUE, cycle, n, "/hrms/performance?view=my-reviews"));
        });
        return out;
    }
}
