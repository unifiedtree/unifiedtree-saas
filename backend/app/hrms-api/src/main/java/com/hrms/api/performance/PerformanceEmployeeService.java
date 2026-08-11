package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Performance directory reads — the "list every employee with their latest
 * review rating" screen the Performance module opens on. Wave 1 (2026-08-11).
 *
 * <p>Uses raw JDBC (not JPA) because the shape is a DISTINCT ON + LEFT JOIN
 * across two schemas (hrms.employees + performance_mgmt.performance_reviews),
 * which is awkward in JPA and trivial in SQL. Mirrors the bindTenant ceremony
 * from {@link com.hrms.api.payroll.PayrollDashboardService} exactly — sets
 * both {@code com.unifiedtree.security.tenant.TenantContext} AND
 * {@code com.hrms.core.tenant.TenantContext} then issues
 * {@code SET LOCAL app.tenant_id} so every subsequent read is RLS-scoped.
 *
 * <p>{@code overallRating} is nullable when the employee has no submitted
 * review — LEFT JOIN plus {@code rs.getBigDecimal} which returns null on SQL
 * NULL. {@code scorePct} is computed at read time from
 * {@code rating / rating_scale_max × 100}, so a company with a 10-point scale
 * still gets a sensible percentage without any per-tenant math client-side.
 */
@Service
public class PerformanceEmployeeService {

    /** Default rating scale when a review row has no cycle (defensive; should never happen). */
    private static final BigDecimal DEFAULT_RATING_SCALE = new BigDecimal("5.0");
    private static final BigDecimal HUNDRED             = new BigDecimal("100");

    /** Reasonable page-size cap so a runaway ?size=999999 doesn't OOM. */
    private static final int MAX_PAGE_SIZE = 200;

    private final JdbcTemplate jdbc;

    public PerformanceEmployeeService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record EmployeePerformanceRowDto(
            UUID       employeeId,
            String     employeeCode,
            String     employeeName,       // first + " " + last (trimmed)
            String     department,         // null when department_id is unset
            UUID       departmentId,
            BigDecimal overallRating,      // NULL when the employee has no submitted review
            BigDecimal scorePct,           // rating / rating_scale_max × 100, HALF_UP, 1 dp; NULL if no review
            String     lastReviewCycleName,
            String     lastReviewSubmittedAt,
            String     lastReviewStatus) {}

    public record PageDto<T>(
            List<T> items,
            int     page,
            int     size,
            long    total) {}

    /**
     * Paged directory of employees with their latest submitted review.
     * Employees with no review appear too, with nulls for rating/score/cycle —
     * they must not be silently omitted (that would hide people from HR).
     *
     * @param departmentId optional filter (null = all)
     * @param search       optional case-insensitive substring against name or code
     * @param page         zero-based
     * @param size         clamped to [1, {@value #MAX_PAGE_SIZE}]
     */
    @Transactional
    public PageDto<EmployeePerformanceRowDto> list(
            UUID tenantId,
            UUID departmentId,
            String search,
            int page,
            int size) {

        bindTenant(tenantId);
        if (page < 0) page = 0;
        if (size <= 0) size = 25;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;

        // ── Filter fragment shared by count + list. Kept identical so the
        //    total always matches the pageable slice.
        StringBuilder where = new StringBuilder("""
                WHERE e.is_active = TRUE
                """);
        List<Object> args = new ArrayList<>();
        if (departmentId != null) {
            where.append(" AND e.department_id = ?");
            args.add(departmentId);
        }
        if (search != null && !search.isBlank()) {
            where.append(" AND (LOWER(e.first_name || ' ' || COALESCE(e.last_name,'')) LIKE ? " +
                         " OR   LOWER(COALESCE(e.employee_code,'')) LIKE ?)");
            String needle = "%" + search.toLowerCase() + "%";
            args.add(needle);
            args.add(needle);
        }

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.employees e " + where,
                Long.class,
                args.toArray());
        if (total == null) total = 0L;

        // Page args come AFTER the filter args.
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add(page * size);

        // DISTINCT ON per employee — takes the most recent submitted review
        // if any, else the most recent created review (drafts). NULLS LAST so
        // employees with no review still appear via the LEFT JOIN.
        String sql = """
                WITH latest_review AS (
                    SELECT DISTINCT ON (pr.employee_id)
                           pr.employee_id,
                           pr.overall_rating,
                           pr.status                  AS review_status,
                           pr.submitted_at,
                           pr.cycle_id,
                           rc.name                    AS cycle_name,
                           rc.rating_scale_max
                      FROM performance_mgmt.performance_reviews pr
                      LEFT JOIN performance_mgmt.review_cycles rc
                             ON rc.id = pr.cycle_id AND rc.tenant_id = pr.tenant_id
                     ORDER BY pr.employee_id,
                              pr.submitted_at DESC NULLS LAST,
                              pr.created_at   DESC
                )
                SELECT e.id                                       AS employee_id,
                       e.employee_code                            AS employee_code,
                       TRIM(e.first_name || ' ' || COALESCE(e.last_name,'')) AS employee_name,
                       d.name                                     AS department,
                       e.department_id                            AS department_id,
                       lr.overall_rating                          AS overall_rating,
                       lr.rating_scale_max                        AS rating_scale_max,
                       lr.cycle_name                              AS cycle_name,
                       lr.submitted_at                            AS submitted_at,
                       lr.review_status                           AS review_status
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d
                         ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN latest_review lr ON lr.employee_id = e.id
                """ + where + """
                 ORDER BY LOWER(e.first_name || ' ' || COALESCE(e.last_name,'')) ASC
                 LIMIT ? OFFSET ?
                """;

        List<EmployeePerformanceRowDto> rows = jdbc.query(sql, (rs, i) -> {
            BigDecimal rating = rs.getBigDecimal("overall_rating");
            BigDecimal scaleMax = rs.getBigDecimal("rating_scale_max");
            if (scaleMax == null || scaleMax.signum() <= 0) scaleMax = DEFAULT_RATING_SCALE;
            BigDecimal pct = rating == null
                    ? null
                    : rating.multiply(HUNDRED).divide(scaleMax, 1, RoundingMode.HALF_UP);
            return new EmployeePerformanceRowDto(
                    rs.getObject("employee_id", UUID.class),
                    rs.getString("employee_code"),
                    rs.getString("employee_name"),
                    rs.getString("department"),
                    rs.getObject("department_id", UUID.class),
                    rating,
                    pct,
                    rs.getString("cycle_name"),
                    ts(rs.getTimestamp("submitted_at")),
                    rs.getString("review_status"));
        }, pageArgs.toArray());

        return new PageDto<>(rows, page, size, total);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
