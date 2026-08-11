package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 360° appraisal cycle fan-out — turns a bare "review cycle" into a live
 * roster of PENDING assignments (one per reviewee × reviewer_type). Wave 3
 * (2026-08-11).
 *
 * <p>Reviewer resolution:
 * <ul>
 *   <li><b>SELF</b> — reviewer = reviewee</li>
 *   <li><b>MANAGER</b> — reviewee's {@code hrms.employees.manager_id}
 *       (if set); skipped otherwise</li>
 *   <li><b>PEER</b> — up to K same-department peers, picked deterministically
 *       by employee_code so re-initiating the same cycle yields the same
 *       roster</li>
 * </ul>
 *
 * <p>For every (reviewee, reviewer_type) we create ONE assignment row + ONE
 * pending {@code performance_reviews} row so the reviewer can see it in
 * their "pending" list on day one. Idempotency: re-calling initiate on an
 * already-fanned-out cycle is a no-op (existing PENDING assignments stay,
 * new ones only for reviewees that were added since).
 */
@Service
public class AppraisalCycleService {

    private static final Logger log = LoggerFactory.getLogger(AppraisalCycleService.class);

    /** Peer count — kept small so the review load stays realistic. */
    private static final int DEFAULT_PEER_COUNT = 3;

    /** 24-hour reminder throttle per review. */
    private static final int REMINDER_THROTTLE_HOURS = 24;

    private final JdbcTemplate jdbc;

    public AppraisalCycleService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record InitiateRequest(
            @jakarta.validation.constraints.NotNull List<String> reviewerTypes,   // ["SELF","MANAGER","PEER"]
            List<UUID> revieweeIds,      // null = all active employees in company
            Integer peerCount) {}

    public record InitiateResultDto(
            UUID cycleId, int revieweesConsidered, int assignmentsCreated,
            int reviewsCreated, List<String> skips) {}

    public record ProgressRowDto(
            UUID revieweeId, String revieweeName, String revieweeCode,
            int totalAssignments, int completedAssignments, double completionPct,
            List<AssignmentSummaryDto> assignments) {}

    public record AssignmentSummaryDto(
            String reviewerType, UUID reviewerId, String reviewerName, String status) {}

    public record CycleProgressDto(
            UUID cycleId, String cycleName, String status,
            int totalAssignments, int completedAssignments, double overallPct,
            List<ProgressRowDto> reviewees) {}

    public record RemindResultDto(UUID reviewId, int newReminderCount, String sentAt) {}

    public record CloseResultDto(UUID cycleId, int missedMarked) {}

    // ── Initiate — the main fan-out ──────────────────────────────────────────

    /**
     * Fan out one PENDING assignment + one PENDING review per (reviewee,
     * reviewer_type). Safe to call multiple times.
     */
    @Transactional
    public InitiateResultDto initiate(UUID tenantId, UUID cycleId,
                                      InitiateRequest req, UUID actorId) {
        bindTenant(tenantId);

        // Validate cycle exists + is in a state that can accept fan-out.
        String cycleStatus = jdbc.query(
                "SELECT status FROM performance_mgmt.review_cycles WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, cycleId);
        if (cycleStatus == null) throw new BusinessRuleException("Cycle not found", "CYCLE_NOT_FOUND");
        if ("CLOSED".equals(cycleStatus)) throw new BusinessRuleException(
                "Cannot fan out a CLOSED cycle", "CYCLE_CLOSED");

        // Validate reviewer types
        Set<String> validTypes = Set.of("SELF", "MANAGER", "PEER", "SKIP_LEVEL", "DIRECT_REPORT");
        List<String> requested = req.reviewerTypes() == null ? List.of() : req.reviewerTypes();
        if (requested.isEmpty()) throw new BusinessRuleException(
                "reviewerTypes cannot be empty", "REVIEWER_TYPES_REQUIRED");
        for (String t : requested) {
            if (!validTypes.contains(t)) throw new BusinessRuleException(
                    "Unknown reviewer type: " + t, "UNKNOWN_REVIEWER_TYPE");
        }
        int peerCount = req.peerCount() == null ? DEFAULT_PEER_COUNT : Math.max(1, Math.min(10, req.peerCount()));

        // Load cycle's company + rating_scale_max (needed later for progress calc)
        UUID companyId = jdbc.queryForObject(
                "SELECT company_id FROM performance_mgmt.review_cycles WHERE id = ?",
                UUID.class, cycleId);

        // Reviewee set: explicit list, or "everyone active in the cycle's company"
        List<UUID> reviewees;
        if (req.revieweeIds() != null && !req.revieweeIds().isEmpty()) {
            reviewees = req.revieweeIds();
        } else {
            reviewees = jdbc.query("""
                    SELECT id FROM hrms.employees
                     WHERE company_id = ? AND is_active = TRUE
                     ORDER BY employee_code ASC
                    """, (rs, i) -> rs.getObject("id", UUID.class), companyId);
        }
        log.info("Cycle {} fan-out considering {} reviewees × {} reviewer_types",
                cycleId, reviewees.size(), requested.size());

        int assignmentsCreated = 0;
        int reviewsCreated = 0;
        List<String> skips = new ArrayList<>();

        for (UUID revieweeId : reviewees) {
            for (String type : requested) {
                List<UUID> reviewerIds = resolveReviewers(revieweeId, type, companyId, peerCount);
                if (reviewerIds.isEmpty()) {
                    skips.add(String.format("reviewee=%s type=%s reason=no-eligible-reviewer",
                            revieweeId, type));
                    continue;
                }
                for (UUID reviewerId : reviewerIds) {
                    // Insert or ignore the assignment (partial UNIQUE covers the (cycle, reviewee, reviewer, type) key)
                    UUID assignmentId;
                    try {
                        assignmentId = jdbc.queryForObject("""
                                INSERT INTO performance_mgmt.appraisal_reviewer_assignments
                                    (tenant_id, cycle_id, reviewee_id, reviewer_id, reviewer_type, status)
                                VALUES (?, ?, ?, ?, ?, 'PENDING')
                                ON CONFLICT (cycle_id, reviewee_id, reviewer_id, reviewer_type)
                                DO UPDATE SET updated_at = performance_mgmt.appraisal_reviewer_assignments.updated_at
                                RETURNING id
                                """, UUID.class,
                                tenantId, cycleId, revieweeId, reviewerId, type);
                    } catch (Exception e) {
                        // Belt-and-braces if the constraint isn't unique — fetch existing.
                        assignmentId = jdbc.query("""
                                SELECT id FROM performance_mgmt.appraisal_reviewer_assignments
                                 WHERE cycle_id = ? AND reviewee_id = ? AND reviewer_id = ? AND reviewer_type = ?
                                """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                                cycleId, revieweeId, reviewerId, type);
                    }
                    if (assignmentId == null) continue;

                    // Was this row NEW (created just now)?
                    boolean isNew = jdbc.query("""
                            SELECT review_id FROM performance_mgmt.appraisal_reviewer_assignments
                             WHERE id = ?
                            """, rs -> rs.next() && rs.getObject("review_id", UUID.class) == null,
                            assignmentId);

                    if (!isNew) continue;    // already had a PENDING review linked
                    assignmentsCreated++;

                    // Create the pending performance_reviews row that shows in
                    // the reviewer's queue and link it back.
                    UUID reviewId = jdbc.queryForObject("""
                            INSERT INTO performance_mgmt.performance_reviews
                                (tenant_id, cycle_id, employee_id, reviewer_id,
                                 status, reviewer_type, created_by)
                            VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
                            RETURNING id
                            """, UUID.class,
                            tenantId, cycleId, revieweeId, reviewerId, type,
                            actorId == null ? null : actorId.toString());
                    jdbc.update("""
                            UPDATE performance_mgmt.appraisal_reviewer_assignments
                               SET review_id = ?, updated_at = now(),
                                   version = version + 1
                             WHERE id = ?
                            """, reviewId, assignmentId);
                    reviewsCreated++;
                }
            }
        }

        // Flip cycle to ACTIVE if it was DRAFT — fan-out means it's live.
        jdbc.update("""
                UPDATE performance_mgmt.review_cycles
                   SET status = CASE WHEN status = 'DRAFT' THEN 'ACTIVE' ELSE status END,
                       updated_at = now(), version = version + 1
                 WHERE id = ?
                """, cycleId);

        log.info("Cycle {} fan-out complete: {} assignments, {} reviews created; {} skips",
                cycleId, assignmentsCreated, reviewsCreated, skips.size());
        return new InitiateResultDto(cycleId, reviewees.size(),
                assignmentsCreated, reviewsCreated, skips);
    }

    // ── Progress ──────────────────────────────────────────────────────────────

    @Transactional
    public CycleProgressDto progress(UUID tenantId, UUID cycleId) {
        bindTenant(tenantId);

        // Load cycle basics
        List<Object[]> cycles = jdbc.query(
                "SELECT id, name, status FROM performance_mgmt.review_cycles WHERE id = ?",
                (rs, i) -> new Object[] { rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("status") },
                cycleId);
        if (cycles.isEmpty()) throw new BusinessRuleException("Cycle not found", "CYCLE_NOT_FOUND");
        Object[] cycle = cycles.get(0);

        // Roll up per-reviewee
        List<ProgressRowDto> reviewees = jdbc.query("""
                SELECT a.reviewee_id                                            AS reviewee_id,
                       TRIM(e.first_name || ' ' || COALESCE(e.last_name,''))    AS reviewee_name,
                       e.employee_code                                          AS reviewee_code,
                       COUNT(*)                                                 AS total,
                       COUNT(*) FILTER (WHERE a.status = 'COMPLETED')           AS completed
                  FROM performance_mgmt.appraisal_reviewer_assignments a
                  LEFT JOIN hrms.employees e ON e.id = a.reviewee_id AND e.tenant_id = a.tenant_id
                 WHERE a.cycle_id = ?
                 GROUP BY a.reviewee_id, e.first_name, e.last_name, e.employee_code
                 ORDER BY reviewee_name
                """, (rs, i) -> {
                    UUID revId  = rs.getObject("reviewee_id", UUID.class);
                    int total   = rs.getInt("total");
                    int done    = rs.getInt("completed");
                    // Per-reviewee assignment list (short call — one query per row is fine at scope)
                    List<AssignmentSummaryDto> perRow = jdbc.query("""
                            SELECT a.reviewer_type, a.reviewer_id, a.status,
                                   TRIM(re.first_name || ' ' || COALESCE(re.last_name,'')) AS reviewer_name
                              FROM performance_mgmt.appraisal_reviewer_assignments a
                              LEFT JOIN hrms.employees re ON re.id = a.reviewer_id AND re.tenant_id = a.tenant_id
                             WHERE a.cycle_id = ? AND a.reviewee_id = ?
                             ORDER BY a.reviewer_type
                            """, (rs2, j) -> new AssignmentSummaryDto(
                                rs2.getString("reviewer_type"),
                                rs2.getObject("reviewer_id", UUID.class),
                                rs2.getString("reviewer_name"),
                                rs2.getString("status")),
                            cycleId, revId);
                    double pct = total == 0 ? 0.0
                            : Math.round((done * 1000.0) / total) / 10.0;
                    return new ProgressRowDto(revId, rs.getString("reviewee_name"),
                            rs.getString("reviewee_code"), total, done, pct, perRow);
                }, cycleId);

        int total = reviewees.stream().mapToInt(ProgressRowDto::totalAssignments).sum();
        int done  = reviewees.stream().mapToInt(ProgressRowDto::completedAssignments).sum();
        double overallPct = total == 0 ? 0.0
                : Math.round((done * 1000.0) / total) / 10.0;

        return new CycleProgressDto((UUID) cycle[0], (String) cycle[1], (String) cycle[2],
                total, done, overallPct, reviewees);
    }

    // ── Reminders ─────────────────────────────────────────────────────────────

    /**
     * Nudge the reviewer to complete a PENDING review. Server-side 24h throttle
     * prevents accidental double-clicks and (more importantly) prevents an
     * HR admin from spamming the reviewer to death.
     */
    @Transactional
    public RemindResultDto remind(UUID tenantId, UUID reviewId, UUID actorId) {
        bindTenant(tenantId);
        Object[] row = jdbc.query("""
                SELECT status, reminder_sent_at, reminder_count
                  FROM performance_mgmt.performance_reviews WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return new Object[] {
                        rs.getString("status"),
                        rs.getTimestamp("reminder_sent_at"),
                        rs.getInt("reminder_count")
                    };
                }, reviewId);
        if (row == null) throw new BusinessRuleException("Review not found", "REVIEW_NOT_FOUND");
        String status = (String) row[0];
        if (!"PENDING".equals(status)) throw new BusinessRuleException(
                "Cannot remind for a review in status " + status, "REVIEW_NOT_PENDING");

        java.sql.Timestamp lastSent = (java.sql.Timestamp) row[1];
        if (lastSent != null) {
            long hoursSince = ChronoUnit.HOURS.between(lastSent.toInstant(), Instant.now());
            if (hoursSince < REMINDER_THROTTLE_HOURS) {
                long waitHours = REMINDER_THROTTLE_HOURS - hoursSince;
                throw new BusinessRuleException(
                        "Please wait " + waitHours + " more hour(s) before sending another reminder",
                        "REMINDER_THROTTLED");
            }
        }
        int newCount = ((Integer) row[2]) + 1;
        jdbc.update("""
                UPDATE performance_mgmt.performance_reviews
                   SET reminder_sent_at = now(), reminder_count = ?,
                       updated_at = now(), version = version + 1
                 WHERE id = ?
                """, newCount, reviewId);
        return new RemindResultDto(reviewId, newCount, Instant.now().toString());
    }

    // ── Close cycle ───────────────────────────────────────────────────────────

    /**
     * Force-close a cycle. Any assignments still PENDING or IN_PROGRESS get
     * marked MISSED, and their linked review rows are marked with a status
     * that reflects the closure (kept as PENDING with a timestamp so history
     * survives; UI treats the assignment's MISSED as authoritative).
     */
    @Transactional
    public CloseResultDto close(UUID tenantId, UUID cycleId, UUID actorId) {
        bindTenant(tenantId);
        String status = jdbc.query(
                "SELECT status FROM performance_mgmt.review_cycles WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, cycleId);
        if (status == null) throw new BusinessRuleException("Cycle not found", "CYCLE_NOT_FOUND");
        if ("CLOSED".equals(status)) return new CloseResultDto(cycleId, 0);   // idempotent

        int missed = jdbc.update("""
                UPDATE performance_mgmt.appraisal_reviewer_assignments
                   SET status = 'MISSED', updated_at = now(), version = version + 1
                 WHERE cycle_id = ? AND status IN ('PENDING','IN_PROGRESS')
                """, cycleId);
        jdbc.update("""
                UPDATE performance_mgmt.review_cycles
                   SET status = 'CLOSED', updated_at = now(),
                       updated_by = ?, version = version + 1
                 WHERE id = ?
                """, actorId == null ? null : actorId.toString(), cycleId);
        log.info("Cycle {} closed by {}: {} assignments marked MISSED",
                cycleId, actorId, missed);
        return new CloseResultDto(cycleId, missed);
    }

    // ── Reviewer resolution helpers ───────────────────────────────────────────

    private List<UUID> resolveReviewers(UUID revieweeId, String type,
                                        UUID companyId, int peerCount) {
        switch (type) {
            case "SELF":
                return List.of(revieweeId);
            case "MANAGER":
                UUID managerId = jdbc.query(
                        "SELECT manager_id FROM hrms.employees WHERE id = ?",
                        rs -> {
                            if (!rs.next()) return null;
                            return rs.getObject("manager_id", UUID.class);
                        }, revieweeId);
                return managerId == null ? List.of() : List.of(managerId);
            case "PEER": {
                UUID deptId = jdbc.query(
                        "SELECT department_id FROM hrms.employees WHERE id = ?",
                        rs -> rs.next() ? rs.getObject("department_id", UUID.class) : null,
                        revieweeId);
                if (deptId == null) return List.of();
                // Same dept, same company, active, not the reviewee. Deterministic
                // order by employee_code so re-runs pick the same peers.
                return jdbc.query("""
                        SELECT id FROM hrms.employees
                         WHERE department_id = ? AND company_id = ?
                           AND is_active = TRUE AND id <> ?
                         ORDER BY employee_code ASC
                         LIMIT ?
                        """, (rs, i) -> rs.getObject("id", UUID.class),
                        deptId, companyId, revieweeId, peerCount);
            }
            case "DIRECT_REPORT": {
                // Upward review: reviewers are the reviewee's direct reports.
                return jdbc.query("""
                        SELECT id FROM hrms.employees
                         WHERE manager_id = ? AND is_active = TRUE
                         ORDER BY employee_code ASC
                        """, (rs, i) -> rs.getObject("id", UUID.class), revieweeId);
            }
            case "SKIP_LEVEL": {
                // Reviewer is the reviewee's manager's manager.
                UUID skipLevel = jdbc.query("""
                        SELECT m2.id FROM hrms.employees e
                          LEFT JOIN hrms.employees m1 ON m1.id = e.manager_id
                          LEFT JOIN hrms.employees m2 ON m2.id = m1.manager_id
                         WHERE e.id = ?
                        """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null, revieweeId);
                return skipLevel == null ? List.of() : List.of(skipLevel);
            }
            default:
                return List.of();
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
