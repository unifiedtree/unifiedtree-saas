package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.performance.dto.ReviewCycleResponse;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Review cycles for the redesigned Performance pages (redesign P-GROW, 2 Oct 2026):
 * <ul>
 *   <li><b>BW-78</b> the dates of a cycle's steps and "hold feedback until shared"
 *       ({@code performance_mgmt.review_cycle_milestones}, V143.61, JDBC only), and Share;</li>
 *   <li><b>BW-79</b> reviews and submitted per cycle, a cycle's stages (counts by
 *       reviewer type and status, one query) and the manager ratings so far;</li>
 *   <li><b>BW-81</b> the reviewer type, the department and the due date of each review;</li>
 *   <li><b>BW-84</b> my current cycle: my steps in the ACTIVE cycles I'm reviewed in.</li>
 * </ul>
 * Counts follow the caller's performance scope ({@link PerformanceTeamScope}): HR and
 * admins the company, a manager their team. Every query filters {@code tenant_id} on
 * every table it reads. Until V143.61 is applied the dates are absent (null) on reads
 * and the writes answer FEATURE_NOT_READY.
 */
@Service
public class PerformanceCycleService {

    private static final Logger log = LoggerFactory.getLogger(PerformanceCycleService.class);
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final String MILESTONES = "performance_mgmt.review_cycle_milestones";

    /** Reviews still to be written. */
    static final List<String> WAITING = List.of("PENDING", "IN_PROGRESS");
    /** Reviews that are done. */
    static final List<String> SUBMITTED = List.of("SUBMITTED", "ACKNOWLEDGED");

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public PerformanceCycleService(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    /** A cycle's step dates. Null fields are not set. */
    public record Milestones(LocalDate goalsBy, LocalDate selfReviewBy, LocalDate managerReviewBy,
                             LocalDate shareOn, boolean holdUntilShared, String sharedAt) {
        static final Milestones NONE = new Milestones(null, null, null, null, false, null);
    }

    /**
     * {@code GET /v1/performance/cycles}: today's fields, plus {@code milestones}
     * ({@link Milestones#NONE} when the cycle has none; {@code null} when V143.61 isn't applied).
     */
    public record CycleView(UUID id, UUID companyId, String name, LocalDate periodStart, LocalDate periodEnd,
                            String status, java.time.Instant createdAt, Milestones milestones) {}

    public record MilestonesRequest(LocalDate goalsBy, LocalDate selfReviewBy, LocalDate managerReviewBy,
                                    LocalDate shareOn, Boolean holdUntilShared) {}

    /** Reviews and submitted per cycle, in the caller's scope. */
    public record CycleCount(UUID cycleId, int reviews, int submitted, int missed, int waiting) {}

    /** One reviewer type's counts in a cycle. */
    public record StageRow(String reviewerType, int total, int submitted, int waiting, int missed) {}

    public record CycleStages(UUID cycleId, String name, String status, LocalDate periodStart, LocalDate periodEnd,
                              int reviewees, List<StageRow> rows, Milestones milestones) {}

    /** How many submitted manager reviews landed on each whole rating, 5 down to 1. */
    public record RatingBucket(int rating, int count) {}

    public record CycleRatings(UUID cycleId, int total, BigDecimal average, List<RatingBucket> buckets) {}

    /** The extra facts each review response carries (BW-81, BW-78). */
    public record ReviewExtras(String reviewerType, String department, LocalDate dueDate) {}

    /** One of my steps in a cycle. */
    public record MyReviewStep(UUID reviewId, String status, String reviewerName, String submittedAt) {}

    public record MyCycle(UUID cycleId, String name, LocalDate periodStart, LocalDate periodEnd, String status,
                          Milestones milestones, int goals, String goalsFirstSetAt,
                          MyReviewStep selfReview, MyReviewStep managerReview, boolean feedbackHeld) {}

    // ── BW-78: dates and sharing ──────────────────────────────────────────────

    /** True when V143.61's milestones table exists. */
    boolean milestonesReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, MILESTONES));
    }

    /** Today's cycle list with each cycle's dates. */
    @Transactional(readOnly = true)
    public List<CycleView> withMilestones(UUID tenantId, List<ReviewCycleResponse> cycles) {
        Map<UUID, Milestones> m = milestonesReady()
                ? milestonesFor(tenantId, cycles.stream().map(ReviewCycleResponse::id).toList())
                : null;
        return cycles.stream().map(c -> new CycleView(c.id(), c.companyId(), c.name(), c.periodStart(), c.periodEnd(),
                c.status() == null ? null : c.status().name(), c.createdAt(),
                m == null ? null : m.getOrDefault(c.id(), Milestones.NONE))).toList();
    }

    /** Milestones of the given cycles (cycles without a row are absent). Callers check readiness. */
    Map<UUID, Milestones> milestonesFor(UUID tenantId, Collection<UUID> cycleIds) {
        if (cycleIds.isEmpty()) return Map.of();
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        args.addAll(cycleIds);
        Map<UUID, Milestones> out = new HashMap<>();
        jdbc.query("SELECT * FROM " + MILESTONES + " WHERE tenant_id = ? AND cycle_id IN (" + marks(cycleIds.size()) + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject("cycle_id", UUID.class), milestones(rs)),
                args.toArray());
        return out;
    }

    /**
     * Set a cycle's step dates and the hold. Dates must run in step order (goals,
     * self-reviews, manager reviews, sharing) where more than one is set.
     */
    @Transactional
    public Milestones saveMilestones(UUID tenantId, UUID cycleId, MilestonesRequest req, UUID actorUserId) {
        validateOrder(req);
        String name = cycleName(tenantId, cycleId);
        if (!milestonesReady()) throw new FeatureNotReady();
        jdbc.update("""
                INSERT INTO performance_mgmt.review_cycle_milestones
                    (tenant_id, cycle_id, goals_by, self_review_by, manager_review_by, share_on, hold_until_shared, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, cycle_id) DO UPDATE
                   SET goals_by = EXCLUDED.goals_by, self_review_by = EXCLUDED.self_review_by,
                       manager_review_by = EXCLUDED.manager_review_by, share_on = EXCLUDED.share_on,
                       hold_until_shared = EXCLUDED.hold_until_shared, updated_by = EXCLUDED.updated_by,
                       updated_at = now()
                """, tenantId, cycleId, sqlDate(req.goalsBy()), sqlDate(req.selfReviewBy()),
                sqlDate(req.managerReviewBy()), sqlDate(req.shareOn()), Boolean.TRUE.equals(req.holdUntilShared()),
                actorUserId);
        record("REVIEW_CYCLE_DATES_SET", cycleId, "Dates set for the review cycle " + name
                + (Boolean.TRUE.equals(req.holdUntilShared()) ? " (feedback held until shared)" : ""));
        return milestonesFor(tenantId, List.of(cycleId)).getOrDefault(cycleId, Milestones.NONE);
    }

    /** Share the cycle's feedback with the people reviewed: held reviews show on their My reviews from now on. */
    @Transactional
    public Milestones share(UUID tenantId, UUID cycleId, UUID actorUserId) {
        String name = cycleName(tenantId, cycleId);
        if (!milestonesReady()) throw new FeatureNotReady();
        jdbc.update("""
                INSERT INTO performance_mgmt.review_cycle_milestones (tenant_id, cycle_id, shared_at, shared_by, updated_by)
                VALUES (?, ?, now(), ?, ?)
                ON CONFLICT (tenant_id, cycle_id) DO UPDATE
                   SET shared_at = COALESCE(performance_mgmt.review_cycle_milestones.shared_at, now()),
                       shared_by = COALESCE(performance_mgmt.review_cycle_milestones.shared_by, EXCLUDED.shared_by),
                       updated_by = EXCLUDED.updated_by, updated_at = now()
                """, tenantId, cycleId, actorUserId, actorUserId);
        record("REVIEW_CYCLE_SHARED", cycleId, "Feedback in the review cycle " + name + " shared with the people reviewed");
        return milestonesFor(tenantId, List.of(cycleId)).getOrDefault(cycleId, Milestones.NONE);
    }

    /**
     * Cycles whose feedback is held from the people reviewed right now: the hold is on
     * and the cycle isn't shared yet. Empty when V143.61 isn't applied (nothing is held).
     */
    Set<UUID> heldCycles(UUID tenantId, Collection<UUID> cycleIds) {
        if (cycleIds.isEmpty() || !milestonesReady()) return Set.of();
        return milestonesFor(tenantId, cycleIds).entrySet().stream()
                .filter(e -> isHeld(e.getValue())).map(Map.Entry::getKey).collect(Collectors.toUnmodifiableSet());
    }

    static boolean isHeld(Milestones m) {
        return m != null && m.holdUntilShared() && m.sharedAt() == null;
    }

    /**
     * Whether a review is hidden from {@code viewer} on My reviews: a SUBMITTED review
     * someone else wrote about them, in a cycle whose feedback is held.
     */
    static boolean hiddenFrom(UUID viewer, UUID employeeId, UUID reviewerId, String status, boolean cycleHeld) {
        if (!cycleHeld || viewer == null || !viewer.equals(employeeId)) return false;
        if (reviewerId == null || reviewerId.equals(viewer)) return false;
        return SUBMITTED.contains(status);
    }

    static void validateOrder(MilestonesRequest req) {
        LocalDate[] steps = { req.goalsBy(), req.selfReviewBy(), req.managerReviewBy(), req.shareOn() };
        String[] names = { "Goals set by", "Self-reviews by", "Manager reviews by", "Shared on" };
        LocalDate last = null;
        String lastName = null;
        for (int i = 0; i < steps.length; i++) {
            if (steps[i] == null) continue;
            if (last != null && steps[i].isBefore(last)) {
                throw new BusinessRuleException(names[i] + " can't be before " + lastName.toLowerCase() + ".",
                        "REVIEW_CYCLE_DATES_ORDER");
            }
            last = steps[i];
            lastName = names[i];
        }
    }

    // ── BW-79: counts, stages, ratings ────────────────────────────────────────

    /** Reviews and submitted for every cycle, about the people in {@code visible} ({@code null} = everyone). */
    @Transactional(readOnly = true)
    public List<CycleCount> summary(UUID tenantId, Set<UUID> visible) {
        StringBuilder sql = new StringBuilder("""
                SELECT r.cycle_id,
                       COUNT(*)                                                         AS reviews,
                       COUNT(*) FILTER (WHERE r.status IN ('SUBMITTED','ACKNOWLEDGED'))  AS submitted,
                       COUNT(*) FILTER (WHERE r.status = 'MISSED')                       AS missed,
                       COUNT(*) FILTER (WHERE r.status IN ('PENDING','IN_PROGRESS'))     AS waiting
                  FROM performance_mgmt.performance_reviews r
                  JOIN performance_mgmt.review_cycles c ON c.id = r.cycle_id AND c.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ?""");
        List<Object> args = new ArrayList<>(List.of(tenantId));
        PerformanceTeamScope.appendIn(sql, args, "r.employee_id", visible);
        sql.append(" GROUP BY r.cycle_id");
        return jdbc.query(sql.toString(), (rs, i) -> new CycleCount(rs.getObject("cycle_id", UUID.class),
                rs.getInt("reviews"), rs.getInt("submitted"), rs.getInt("missed"), rs.getInt("waiting")), args.toArray());
    }

    /** A cycle's reviews by reviewer type and status (one query), with its dates. */
    @Transactional(readOnly = true)
    public CycleStages stages(UUID tenantId, UUID cycleId, Set<UUID> visible) {
        Object[] cycle = cycleRow(tenantId, cycleId);
        StringBuilder sql = new StringBuilder("""
                SELECT r.reviewer_type,
                       COUNT(*)                                                         AS total,
                       COUNT(*) FILTER (WHERE r.status IN ('SUBMITTED','ACKNOWLEDGED'))  AS submitted,
                       COUNT(*) FILTER (WHERE r.status IN ('PENDING','IN_PROGRESS'))     AS waiting,
                       COUNT(*) FILTER (WHERE r.status = 'MISSED')                       AS missed,
                       COUNT(DISTINCT r.employee_id)                                     AS reviewees
                  FROM performance_mgmt.performance_reviews r
                 WHERE r.tenant_id = ? AND r.cycle_id = ?""");
        List<Object> args = new ArrayList<>(List.of(tenantId, cycleId));
        PerformanceTeamScope.appendIn(sql, args, "r.employee_id", visible);
        sql.append(" GROUP BY ROLLUP (r.reviewer_type) ORDER BY r.reviewer_type NULLS LAST");
        List<StageRow> rows = new ArrayList<>();
        int[] reviewees = { 0 };
        jdbc.query(sql.toString(), (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
            String type = rs.getString("reviewer_type");
            if (type == null) { reviewees[0] = rs.getInt("reviewees"); return; }  // the ROLLUP total row
            rows.add(new StageRow(type, rs.getInt("total"), rs.getInt("submitted"), rs.getInt("waiting"), rs.getInt("missed")));
        }, args.toArray());
        Milestones m = milestonesReady() ? milestonesFor(tenantId, List.of(cycleId)).getOrDefault(cycleId, Milestones.NONE) : null;
        return new CycleStages(cycleId, (String) cycle[0], (String) cycle[1], (LocalDate) cycle[2], (LocalDate) cycle[3],
                reviewees[0], rows, m);
    }

    /**
     * Submitted manager reviews in a cycle by whole rating (5 down to 1). A manager
     * review is reviewer type MANAGER (also what a review written directly by HR or
     * a manager is stored as). A rating counts in its whole number (4.6 → 4, as the design reads "4.6 · Exceeds"); under 1 counts as 1.
     */
    @Transactional(readOnly = true)
    public CycleRatings ratings(UUID tenantId, UUID cycleId, Set<UUID> visible) {
        cycleRow(tenantId, cycleId);
        StringBuilder sql = new StringBuilder("""
                SELECT GREATEST(1, LEAST(5, FLOOR(r.overall_rating)))::int AS bucket, COUNT(*) AS n,
                       SUM(r.overall_rating) AS total
                  FROM performance_mgmt.performance_reviews r
                 WHERE r.tenant_id = ? AND r.cycle_id = ? AND r.reviewer_type = 'MANAGER'
                   AND r.status IN ('SUBMITTED','ACKNOWLEDGED') AND r.overall_rating IS NOT NULL""");
        List<Object> args = new ArrayList<>(List.of(tenantId, cycleId));
        PerformanceTeamScope.appendIn(sql, args, "r.employee_id", visible);
        sql.append(" GROUP BY 1");
        Map<Integer, Integer> counts = new HashMap<>();
        BigDecimal[] sum = { BigDecimal.ZERO };
        jdbc.query(sql.toString(), (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
            counts.put(rs.getInt("bucket"), rs.getInt("n"));
            BigDecimal t = rs.getBigDecimal("total");
            if (t != null) sum[0] = sum[0].add(t);
        }, args.toArray());
        return buckets(cycleId, counts, sum[0]);
    }

    static CycleRatings buckets(UUID cycleId, Map<Integer, Integer> counts, BigDecimal sum) {
        List<RatingBucket> out = new ArrayList<>();
        int total = 0;
        for (int r = 5; r >= 1; r--) {
            int n = counts.getOrDefault(r, 0);
            total += n;
            out.add(new RatingBucket(r, n));
        }
        BigDecimal avg = total == 0 ? null : sum.divide(BigDecimal.valueOf(total), 1, RoundingMode.HALF_UP);
        return new CycleRatings(cycleId, total, avg, out);
    }

    // ── BW-81: per-review extras ──────────────────────────────────────────────

    /** Reviewer type, the reviewee's department and the review's due date, by review id. */
    @Transactional(readOnly = true)
    public Map<UUID, ReviewExtras> extras(UUID tenantId, Collection<UUID> reviewIds) {
        if (reviewIds.isEmpty()) return Map.of();
        boolean ready = milestonesReady();
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        args.addAll(reviewIds);
        String sql = """
                SELECT r.id, r.reviewer_type, d.name AS department"""
                + (ready ? ", m.self_review_by, m.manager_review_by" : "") + """

                  FROM performance_mgmt.performance_reviews r
                  LEFT JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id"""
                + (ready ? """

                  LEFT JOIN performance_mgmt.review_cycle_milestones m ON m.cycle_id = r.cycle_id AND m.tenant_id = r.tenant_id"""
                        : "") + """

                 WHERE r.tenant_id = ? AND r.id IN (""" + marks(reviewIds.size()) + ")";
        Map<UUID, ReviewExtras> out = new HashMap<>();
        jdbc.query(sql, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
            String type = rs.getString("reviewer_type");
            LocalDate due = null;
            if (ready) due = dueDate(type, day(rs, "self_review_by"), day(rs, "manager_review_by"));
            out.put(rs.getObject("id", UUID.class), new ReviewExtras(type, rs.getString("department"), due));
        }, args.toArray());
        return out;
    }

    /** A self review is due by the self-review date; every other review by the manager-review date. */
    static LocalDate dueDate(String reviewerType, LocalDate selfBy, LocalDate managerBy) {
        return "SELF".equals(reviewerType) ? selfBy : managerBy;
    }

    /** Status filter for the review list: WAITING, SUBMITTED or MISSED (blank = all). */
    static List<String> statusesFor(String filter) {
        if (filter == null || filter.isBlank()) return null;
        return switch (filter.trim().toUpperCase(java.util.Locale.ROOT)) {
            case "WAITING" -> WAITING;
            case "SUBMITTED" -> SUBMITTED;
            case "MISSED" -> List.of("MISSED");
            default -> throw new BusinessRuleException("Status must be WAITING, SUBMITTED or MISSED", "INVALID_STATUS");
        };
    }

    // ── BW-84: my current cycle ───────────────────────────────────────────────

    /**
     * The ACTIVE cycles the caller is reviewed in, newest first, each with their steps:
     * goals for the cycle, their self-review and their manager's review. The manager
     * review shows who writes it and its status; its content stays on My reviews.
     */
    @Transactional(readOnly = true)
    public List<MyCycle> myCurrent(UUID tenantId, UUID employeeId) {
        if (employeeId == null) return List.of();
        List<Object[]> cycles = jdbc.query("""
                SELECT DISTINCT c.id, c.name, c.period_start, c.period_end, c.status
                  FROM performance_mgmt.review_cycles c
                  JOIN performance_mgmt.performance_reviews r ON r.cycle_id = c.id AND r.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ? AND c.status = 'ACTIVE' AND r.employee_id = ?
                 ORDER BY c.period_start DESC NULLS LAST, c.name
                """, (rs, i) -> new Object[] { rs.getObject("id", UUID.class), rs.getString("name"),
                        day(rs, "period_start"), day(rs, "period_end"), rs.getString("status") },
                tenantId, employeeId);
        if (cycles.isEmpty()) return List.of();
        List<UUID> ids = cycles.stream().map(c -> (UUID) c[0]).toList();
        Map<UUID, Milestones> ms = milestonesReady() ? milestonesFor(tenantId, ids) : null;

        // Reviews about me in these cycles, with the reviewer's name.
        List<Object> args = new ArrayList<>(List.of(tenantId, employeeId));
        args.addAll(ids);
        Map<UUID, MyReviewStep> self = new HashMap<>(), manager = new HashMap<>();
        jdbc.query("""
                SELECT r.id, r.cycle_id, r.reviewer_id, r.reviewer_type, r.status, r.submitted_at,
                       NULLIF(TRIM(COALESCE(rv.first_name,'') || ' ' || COALESCE(rv.last_name,'')), '') AS reviewer_name
                  FROM performance_mgmt.performance_reviews r
                  LEFT JOIN hrms.employees rv ON rv.id = r.reviewer_id AND rv.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.employee_id = ? AND r.cycle_id IN (""" + marks(ids.size()) + """
                )
                 ORDER BY r.created_at
                """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID cycle = rs.getObject("cycle_id", UUID.class);
                    UUID reviewer = rs.getObject("reviewer_id", UUID.class);
                    String type = rs.getString("reviewer_type");
                    java.sql.Timestamp at = rs.getTimestamp("submitted_at");
                    MyReviewStep step = new MyReviewStep(rs.getObject("id", UUID.class), rs.getString("status"),
                            rs.getString("reviewer_name"), at == null ? null : at.toInstant().toString());
                    boolean isSelf = "SELF".equals(type) || reviewer == null || reviewer.equals(employeeId);
                    if (isSelf) self.putIfAbsent(cycle, step);
                    else if ("MANAGER".equals(type)) manager.putIfAbsent(cycle, step);
                }, args.toArray());

        List<MyCycle> out = new ArrayList<>();
        for (Object[] c : cycles) {
            UUID id = (UUID) c[0];
            Milestones m = ms == null ? null : ms.getOrDefault(id, Milestones.NONE);
            StringBuilder goalsSql = new StringBuilder("""
                    SELECT COUNT(*) AS n, MIN(g.created_at) AS first_at FROM performance_mgmt.goals g
                     WHERE g.tenant_id = ? AND g.employee_id = ? AND g.status <> 'DROPPED'""");
            List<Object> gArgs = new ArrayList<>(List.of(tenantId, employeeId));
            PerformanceInsightService.appendCycleWindow(goalsSql, gArgs, id,
                    c[2] == null ? null : c[2].toString(), c[3] == null ? null : c[3].toString());
            Object[] goals = jdbc.query(goalsSql.toString(), rs -> {
                if (!rs.next()) return new Object[] { 0, null };
                java.sql.Timestamp first = rs.getTimestamp("first_at");
                return new Object[] { rs.getInt("n"), first == null ? null : first.toInstant().toString() };
            }, gArgs.toArray());
            out.add(new MyCycle(id, (String) c[1], (LocalDate) c[2], (LocalDate) c[3], (String) c[4], m,
                    goals == null ? 0 : (Integer) goals[0], goals == null ? null : (String) goals[1],
                    self.get(id), manager.get(id), isHeld(m)));
        }
        return out;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** name, status, period start, period end; 404 when the cycle isn't in this tenant. */
    private Object[] cycleRow(UUID tenantId, UUID cycleId) {
        Object[] row = jdbc.query("""
                SELECT name, status, period_start, period_end FROM performance_mgmt.review_cycles
                 WHERE tenant_id = ? AND id = ?
                """, rs -> rs.next() ? new Object[] { rs.getString("name"), rs.getString("status"),
                        day(rs, "period_start"), day(rs, "period_end") } : null, tenantId, cycleId);
        if (row == null) throw new ResourceNotFoundException("Review cycle", cycleId);
        return row;
    }

    private String cycleName(UUID tenantId, UUID cycleId) {
        return (String) cycleRow(tenantId, cycleId)[0];
    }

    private static Milestones milestones(ResultSet rs) throws SQLException {
        java.sql.Timestamp shared = rs.getTimestamp("shared_at");
        return new Milestones(day(rs, "goals_by"), day(rs, "self_review_by"), day(rs, "manager_review_by"),
                day(rs, "share_on"), rs.getBoolean("hold_until_shared"), shared == null ? null : shared.toInstant().toString());
    }

    private static LocalDate day(ResultSet rs, String column) throws SQLException {
        java.sql.Date d = rs.getDate(column);
        return d == null ? null : d.toLocalDate();
    }

    private static java.sql.Date sqlDate(LocalDate d) {
        return d == null ? null : java.sql.Date.valueOf(d);
    }

    static String marks(int n) {
        return String.join(",", java.util.Collections.nCopies(n, "?"));
    }

    private void record(String action, UUID cycleId, String summary) {
        try {
            audit.record("performance", action, "review_cycle", cycleId, summary);
        } catch (Exception e) {
            log.warn("Audit of {} failed (non-fatal): {}", action, e.getMessage());
        }
    }
}
