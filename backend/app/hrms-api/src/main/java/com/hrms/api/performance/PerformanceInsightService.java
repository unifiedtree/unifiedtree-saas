package com.hrms.api.performance;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.performance.dto.GoalProgressRequest;
import com.hrms.performance.dto.GoalResponse;
import com.hrms.performance.service.GoalService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Performance reads and writes for people outside the admin screens (2026-09-25):
 * <ul>
 *   <li>the goals and KPIs of the person a review is about, shown while the
 *       review is being written ({@link #reviewGoals});</li>
 *   <li>an employee's own progress history for a goal or KPI, under My goals
 *       ({@link #myGoalHistory});</li>
 *   <li>an employee's own progress update on a personal goal, now recorded in
 *       the same history table as KPI updates ({@link #updateMyGoalProgress}).</li>
 * </ul>
 * All of it reads {@code performance_mgmt.goals} and
 * {@code performance_mgmt.kpi_progress_updates}; object access is decided here,
 * from the authenticated principal only.
 */
@Service
public class PerformanceInsightService {

    /** Longest note an employee may attach to a progress update. */
    static final int MAX_NOTE = 1000;

    private final JdbcTemplate jdbc;
    private final PerformanceTeamScope teamScope;
    private final KpiService kpiService;
    private final GoalService goalService;

    public PerformanceInsightService(JdbcTemplate jdbc, PerformanceTeamScope teamScope,
                                     KpiService kpiService, GoalService goalService) {
        this.jdbc = jdbc;
        this.teamScope = teamScope;
        this.kpiService = kpiService;
        this.goalService = goalService;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    /** One goal or KPI as the reviewer sees it. {@code kpi} is true for measured KPIs (with a target). */
    public record GoalSnapshotDto(
            UUID id, String title, String category, boolean kpi,
            BigDecimal targetValue, BigDecimal currentValue, String unit, String direction,
            int progressPct, int weight, String dueDate, String status, UUID cycleId) {}

    public record ReviewGoalsDto(
            UUID reviewId, UUID employeeId, String employeeName,
            UUID cycleId, String cycleName, String periodStart, String periodEnd,
            List<GoalSnapshotDto> goals) {}

    /** Body of PUT /v1/performance/goals/{id}/progress: the new percentage and an optional note. */
    public record SelfGoalProgressRequest(
            int progress,
            @jakarta.validation.constraints.Size(max = MAX_NOTE) String note) {}

    // ── The reviewee's goals while writing a review ───────────────────────────

    /**
     * Goals and KPIs of the person a review is about, for that review's cycle:
     * goals tied to the cycle, plus goals tied to no cycle that were live during
     * it (due on or after the cycle start, or with no due date, and created by
     * the cycle end). Dropped goals are left out.
     *
     * <p>Who may read them: the assigned reviewer, the person being reviewed, or
     * someone with {@code hrms.performance.read} whose performance scope covers
     * the reviewee (HR / admin: everyone; managers: their team).
     */
    @Transactional
    public ReviewGoalsDto reviewGoals(UUID tenantId, UUID reviewId) {
        bindTenant(tenantId);
        ReviewRef ref = jdbc.query("""
                SELECT r.employee_id, r.reviewer_id, r.cycle_id,
                       c.name AS cycle_name, c.period_start, c.period_end,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS employee_name
                  FROM performance_mgmt.performance_reviews r
                  LEFT JOIN performance_mgmt.review_cycles c ON c.id = r.cycle_id AND c.tenant_id = r.tenant_id
                  LEFT JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.id = ?
                """, rs -> rs.next() ? new ReviewRef(
                        rs.getObject("employee_id", UUID.class),
                        rs.getObject("reviewer_id", UUID.class),
                        rs.getObject("cycle_id", UUID.class),
                        rs.getString("cycle_name"),
                        date(rs, "period_start"), date(rs, "period_end"),
                        rs.getString("employee_name")) : null,
                tenantId, reviewId);
        if (ref == null) throw new ResourceNotFoundException("Review", reviewId);

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        boolean performanceRead = hasAuthority(auth, "hrms.performance.read");
        UUID caller = callerEmployeeId(auth);
        boolean directlyInvolved = mayReadAsParticipant(caller, ref.employeeId(), ref.reviewerId());
        if (!directlyInvolved) {
            Set<UUID> visible = performanceRead ? teamScope.visibleEmployeeIds() : Set.of();
            if (!performanceRead || !(visible == null || visible.contains(ref.employeeId()))) {
                throw new AccessDeniedException("You can only see the goals of reviews assigned to you");
            }
        }

        StringBuilder sql = new StringBuilder("""
                SELECT g.* FROM performance_mgmt.goals g
                 WHERE g.tenant_id = ? AND g.employee_id = ? AND g.status <> 'DROPPED'
                """);
        List<Object> args = new ArrayList<>(List.of(tenantId, ref.employeeId()));
        appendCycleWindow(sql, args, ref.cycleId(), ref.periodStart(), ref.periodEnd());
        sql.append(" ORDER BY (g.target_value IS NULL), g.due_date NULLS LAST, LOWER(g.title)");
        List<GoalSnapshotDto> goals = jdbc.query(sql.toString(), (rs, i) -> snapshot(rs), args.toArray());
        return new ReviewGoalsDto(reviewId, ref.employeeId(),
                ref.employeeName() == null || ref.employeeName().isBlank() ? null : ref.employeeName(),
                ref.cycleId(), ref.cycleName(), ref.periodStart(), ref.periodEnd(), goals);
    }

    /** The reviewer, the reviewee, or (for a self review with no reviewer set) the reviewee. */
    static boolean mayReadAsParticipant(UUID caller, UUID reviewee, UUID reviewer) {
        if (caller == null) return false;
        return caller.equals(reviewee) || caller.equals(reviewer);
    }

    /**
     * Restricts goals to one review cycle: tied to the cycle, or tied to none and
     * live during it. A missing period bound leaves that side open.
     */
    static void appendCycleWindow(StringBuilder sql, List<Object> args, UUID cycleId,
                                  String periodStart, String periodEnd) {
        sql.append(" AND (");
        if (cycleId != null) {
            sql.append("g.cycle_id = ? OR ");
            args.add(cycleId);
        }
        sql.append("(g.cycle_id IS NULL");
        if (periodStart != null) {
            sql.append(" AND (g.due_date IS NULL OR g.due_date >= ?)");
            args.add(java.sql.Date.valueOf(periodStart));
        }
        if (periodEnd != null) {
            // Business dates are India dates, never UTC.
            sql.append(" AND (g.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ?");
            args.add(java.sql.Date.valueOf(periodEnd));
        }
        sql.append("))");
    }

    // ── My goals: history and personal progress ───────────────────────────────

    /** Progress history of one of the caller's own goals or KPIs, newest first. */
    @Transactional
    public List<KpiService.ProgressUpdateDto> myGoalHistory(UUID tenantId, UUID goalId, UUID employeeId) {
        bindTenant(tenantId);
        UUID owner = jdbc.query(
                "SELECT employee_id FROM performance_mgmt.goals WHERE tenant_id = ? AND id = ?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, tenantId, goalId);
        if (owner == null) throw new ResourceNotFoundException("Goal", goalId);
        if (employeeId == null || !employeeId.equals(owner)) {
            throw new AccessDeniedException("You can only see the history of your own goals");
        }
        return kpiService.historyRows(tenantId, goalId);
    }

    /**
     * Employee updates the percentage on one of their own personal goals. The
     * rules stay in {@link GoalService#updateProgress} (own goals only; measured
     * KPIs are updated by the performance admin, not with a slider). Each change
     * is also written to the progress history, with the note, so My goals can show
     * who changed what and when.
     */
    @Transactional
    public GoalResponse updateMyGoalProgress(UUID tenantId, UUID goalId, UUID employeeId,
                                             SelfGoalProgressRequest req, UUID actorUserId) {
        bindTenant(tenantId);
        Integer previous = jdbc.query(
                "SELECT progress FROM performance_mgmt.goals WHERE tenant_id = ? AND id = ? AND employee_id = ?",
                rs -> rs.next() ? rs.getInt(1) : null, tenantId, goalId, employeeId);
        GoalResponse updated = goalService.updateProgress(goalId, employeeId, new GoalProgressRequest(req.progress()));
        String note = cleanNote(req.note());
        if (shouldRecord(previous, updated.progress(), note)) {
            BigDecimal now = BigDecimal.valueOf(updated.progress());
            jdbc.update("""
                    INSERT INTO performance_mgmt.kpi_progress_updates
                        (tenant_id, goal_id, previous_value, new_value, progress_pct, notes, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, tenantId, goalId, previous == null ? null : BigDecimal.valueOf(previous),
                    now, now, note, actorUserId);
        }
        return updated;
    }

    /** A history row is written when the value changed, or when the person left a note. */
    static boolean shouldRecord(Integer previous, int now, String note) {
        return previous == null || previous != now || note != null;
    }

    static String cleanNote(String note) {
        if (note == null) return null;
        String t = note.trim();
        if (t.isEmpty()) return null;
        return t.length() > MAX_NOTE ? t.substring(0, MAX_NOTE) : t;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private record ReviewRef(UUID employeeId, UUID reviewerId, UUID cycleId, String cycleName,
                             String periodStart, String periodEnd, String employeeName) {}

    private static GoalSnapshotDto snapshot(ResultSet rs) throws SQLException {
        BigDecimal target = rs.getBigDecimal("target_value");
        java.sql.Date due = rs.getDate("due_date");
        return new GoalSnapshotDto(
                rs.getObject("id", UUID.class),
                rs.getString("title"),
                rs.getString("category"),
                target != null,
                target,
                rs.getBigDecimal("current_value"),
                rs.getString("unit"),
                rs.getString("direction"),
                rs.getInt("progress"),
                rs.getInt("weight"),
                due == null ? null : due.toString(),
                rs.getString("status"),
                rs.getObject("cycle_id", UUID.class));
    }

    private static String date(ResultSet rs, String column) throws SQLException {
        java.sql.Date d = rs.getDate(column);
        return d == null ? null : d.toString();
    }

    static boolean hasAuthority(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    /** The caller's employee id from the token claim only (never the user id). */
    static UUID callerEmployeeId(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return null;
        String claim = jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try { return UUID.fromString(claim.trim()); } catch (IllegalArgumentException e) { return null; }
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
