package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The Hiring page's numbers (redesign BW-65, BW-66, BW-68), counted in the
 * database so they are right however many requisitions and candidates there
 * are (the page used to count the first page of 20 in the browser).
 *
 * <ul>
 *   <li>{@link #summary}: requisitions by status, positions to fill,
 *       candidates this quarter and the stages of candidates on open roles.</li>
 *   <li>{@link #funnel}: how far the candidates added in a period got, the
 *       conversion between stages and the time to hire, from the stage history
 *       (hiring_mgmt.candidate_stage_events, V143.59). Candidates added before
 *       the history existed are left out and counted separately, so every rate
 *       is exact; with none tracked the rates are null (the page shows "—").</li>
 *   <li>{@link #myInterviews}: the signed-in interviewer's quarter.</li>
 * </ul>
 * Quarters are calendar quarters in India time.
 */
@Service
public class HiringInsightsService {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** The pipeline stages in order (REJECTED and WITHDRAWN are exits, not steps). */
    static final List<String> FUNNEL = List.of("APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED");
    static final List<String> ALL_STAGES = List.of("APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN");

    private final JdbcTemplate jdbc;

    public HiringInsightsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── shapes ───────────────────────────────────────────────────────────────

    public record Requisitions(long open, long onHold, long closed, long total) {}

    public record StageCount(String stage, long count) {}

    public record Summary(UUID companyId, Requisitions requisitions, long positionsToFill,
                          long candidatesThisQuarter, LocalDate quarterStart, LocalDate quarterEnd,
                          List<StageCount> openRoleStages) {}

    public record Reached(String stage, long reached) {}

    /** {@code rate} is 0..1, null when nobody reached {@code from}. */
    public record Conversion(String from, String to, long fromCount, long toCount, Double rate) {}

    /** {@code averageDays} is null when nobody tracked was hired in the period. */
    public record TimeToHire(Double averageDays, long hires) {}

    /**
     * @param trackedFrom         when the stage history starts (the first row in the workspace); null when there is none yet
     * @param exact               true when the whole period is inside the history, so nobody was left out
     * @param trackedCandidates   candidates added in the period with a full history (the cohort the rates use)
     * @param untrackedCandidates candidates added in the period before the history existed (left out)
     */
    public record Funnel(LocalDate from, LocalDate to, UUID companyId, Instant trackedFrom, boolean exact,
                         long trackedCandidates, long untrackedCandidates, List<Reached> stages,
                         List<Conversion> conversions, TimeToHire timeToHire) {}

    /**
     * @param tookThisQuarter              interviews you were on this quarter that have started (not cancelled)
     * @param scorecardsSubmittedThisQuarter your scorecards submitted this quarter
     * @param scorecardsDue                started interviews of the last 60 days still waiting for your scorecard
     * @param upcoming                     your interviews still to come
     */
    public record MyInterviews(LocalDate quarterStart, LocalDate quarterEnd, long tookThisQuarter,
                               long scorecardsSubmittedThisQuarter, long scorecardsDue, long upcoming) {}

    // ── BW-65 summary ────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Summary summary(UUID companyId, LocalDate today) {
        UUID tenant = TenantContext.requireTenantId();
        LocalDate qStart = quarterStart(today);
        LocalDate qEnd = qStart.plusMonths(3).minusDays(1);
        String company = companyId == null ? " " : " AND r.company_id = ? ";

        long[] byStatus = new long[3];
        long[] toFill = new long[1];
        List<Object> args = args(tenant, companyId);
        jdbc.query("SELECT r.status, count(*) AS n, COALESCE(sum(r.openings), 0) AS openings"
                        + " FROM hiring_mgmt.job_requisitions r WHERE r.tenant_id = ?" + company + " GROUP BY r.status",
                (RowCallbackHandler) rs -> {
                    String status = rs.getString("status");
                    long n = rs.getLong("n");
                    switch (status == null ? "" : status) {
                        case "OPEN" -> { byStatus[0] += n; toFill[0] += rs.getLong("openings"); }
                        case "ON_HOLD" -> { byStatus[1] += n; toFill[0] += rs.getLong("openings"); }
                        case "CLOSED" -> byStatus[2] += n;
                        default -> { }
                    }
                }, args.toArray());

        List<Object> qArgs = args(tenant, companyId);
        qArgs.add(Timestamp.from(startOfDay(qStart)));
        qArgs.add(Timestamp.from(startOfDay(qEnd.plusDays(1))));
        Long thisQuarter = jdbc.queryForObject("SELECT count(*) FROM hiring_mgmt.candidates c"
                + " JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id"
                + " WHERE c.tenant_id = ?" + company + " AND c.created_at >= ? AND c.created_at < ?", Long.class, qArgs.toArray());

        Map<String, Long> stages = new LinkedHashMap<>();
        ALL_STAGES.forEach(s -> stages.put(s, 0L));
        jdbc.query("SELECT c.stage, count(*) AS n FROM hiring_mgmt.candidates c"
                        + " JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id"
                        + " WHERE c.tenant_id = ?" + company + " AND r.status = 'OPEN' GROUP BY c.stage",
                (RowCallbackHandler) rs -> stages.merge(rs.getString("stage"), rs.getLong("n"), Long::sum), args(tenant, companyId).toArray());

        return new Summary(companyId,
                new Requisitions(byStatus[0], byStatus[1], byStatus[2], byStatus[0] + byStatus[1] + byStatus[2]),
                toFill[0], thisQuarter == null ? 0 : thisQuarter, qStart, qEnd,
                stages.entrySet().stream().map(e -> new StageCount(e.getKey(), e.getValue())).toList());
    }

    // ── BW-66 funnel ─────────────────────────────────────────────────────────

    /**
     * Candidates added between {@code from} and {@code to} (inclusive, India
     * time): how many reached each stage by now (a candidate who got further
     * counts for every earlier stage too), the conversion between neighbouring
     * stages, and the average days from being added to being hired for tracked
     * candidates hired in the period. Answers FEATURE_NOT_READY while V143.59 is
     * not applied.
     */
    @Transactional(readOnly = true)
    public Funnel funnel(UUID companyId, LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from))
            throw new BusinessRuleException("Choose a start date on or before the end date", "FUNNEL_RANGE_INVALID");
        if (from.plusYears(5).isBefore(to))
            throw new BusinessRuleException("Choose a period of at most five years", "FUNNEL_RANGE_INVALID");
        UUID tenant = TenantContext.requireTenantId();
        if (!JdbcCandidateStageLog.tablePresent(jdbc, JdbcCandidateStageLog.TABLE)) throw new FeatureNotReady();
        Timestamp start = Timestamp.from(startOfDay(from));
        Timestamp end = Timestamp.from(startOfDay(to.plusDays(1)));
        String company = companyId == null ? " " : " AND r.company_id = ? ";

        return FeatureNotReady.guard(() -> {
            Instant trackedFrom = jdbc.queryForObject(
                    "SELECT min(changed_at) FROM hiring_mgmt.candidate_stage_events WHERE tenant_id = ?",
                    (rs, i) -> rs.getTimestamp(1) == null ? null : rs.getTimestamp(1).toInstant(), tenant);

            // The cohort: candidates whose "added" row falls in the period; per
            // candidate, the furthest pipeline stage reached so far.
            List<Object> cohortArgs = args(tenant, companyId);
            cohortArgs.add(start);
            cohortArgs.add(end);
            long[] furthest = new long[FUNNEL.size()];
            long[] cohort = new long[1];
            jdbc.query("""
                    WITH cohort AS (
                        SELECT e.candidate_id
                          FROM hiring_mgmt.candidate_stage_events e
                          JOIN hiring_mgmt.candidates c ON c.id = e.candidate_id AND c.tenant_id = e.tenant_id
                          JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                         WHERE e.tenant_id = ?""" + company + """
                           AND e.event_kind = 'ADDED' AND e.changed_at >= ? AND e.changed_at < ?
                         GROUP BY e.candidate_id
                    )
                    SELECT k.candidate_id,
                           max(CASE s.to_stage WHEN 'APPLIED' THEN 0 WHEN 'SCREENING' THEN 1 WHEN 'INTERVIEW' THEN 2
                                               WHEN 'OFFER' THEN 3 WHEN 'HIRED' THEN 4 END) AS furthest
                      FROM cohort k
                      JOIN hiring_mgmt.candidate_stage_events s ON s.candidate_id = k.candidate_id AND s.tenant_id = ?
                     GROUP BY k.candidate_id
                    """, (RowCallbackHandler) rs -> {
                cohort[0]++;
                int f = rs.getInt("furthest");
                if (!rs.wasNull() && f >= 0 && f < furthest.length) furthest[f]++;
            }, append(cohortArgs, tenant).toArray());

            List<Reached> reached = new ArrayList<>();
            long[] reachedCounts = new long[FUNNEL.size()];
            for (int i = FUNNEL.size() - 1; i >= 0; i--) {
                reachedCounts[i] = furthest[i] + (i + 1 < FUNNEL.size() ? reachedCounts[i + 1] : 0);
            }
            for (int i = 0; i < FUNNEL.size(); i++) reached.add(new Reached(FUNNEL.get(i), reachedCounts[i]));
            List<Conversion> conversions = new ArrayList<>();
            for (int i = 0; i + 1 < FUNNEL.size(); i++) {
                long a = reachedCounts[i], b = reachedCounts[i + 1];
                conversions.add(new Conversion(FUNNEL.get(i), FUNNEL.get(i + 1), a, b, a == 0 ? null : round((double) b / a)));
            }

            // Added in the period but before the history existed: counted, not used.
            List<Object> oldArgs = args(tenant, companyId);
            oldArgs.add(start);
            oldArgs.add(end);
            Long untracked = jdbc.queryForObject("""
                    SELECT count(*) FROM hiring_mgmt.candidates c
                      JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                     WHERE c.tenant_id = ?""" + company + """
                       AND c.created_at >= ? AND c.created_at < ?
                       AND NOT EXISTS (SELECT 1 FROM hiring_mgmt.candidate_stage_events e
                                        WHERE e.tenant_id = c.tenant_id AND e.candidate_id = c.id AND e.event_kind = 'ADDED')
                    """, Long.class, oldArgs.toArray());

            // Time to hire: tracked candidates first hired in the period.
            Map<String, Object> hire = jdbc.queryForMap("""
                    WITH hired AS (
                        SELECT e.candidate_id, min(e.changed_at) AS hired_at
                          FROM hiring_mgmt.candidate_stage_events e
                          JOIN hiring_mgmt.candidates c ON c.id = e.candidate_id AND c.tenant_id = e.tenant_id
                          JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                         WHERE e.tenant_id = ?""" + company + """
                           AND e.to_stage = 'HIRED' AND e.event_kind <> 'CONVERTED'
                         GROUP BY e.candidate_id
                    )
                    SELECT count(*) AS hires,
                           avg(EXTRACT(EPOCH FROM (h.hired_at - a.added_at)) / 86400.0) AS avg_days
                      FROM hired h
                      JOIN (SELECT candidate_id, min(changed_at) AS added_at FROM hiring_mgmt.candidate_stage_events
                             WHERE tenant_id = ? AND event_kind = 'ADDED' GROUP BY candidate_id) a
                        ON a.candidate_id = h.candidate_id
                     WHERE h.hired_at >= ? AND h.hired_at < ?
                    """, reorderForHire(tenant, companyId, start, end));
            long hires = ((Number) hire.get("hires")).longValue();
            Number avg = (Number) hire.get("avg_days");

            boolean exact = trackedFrom != null && !start.toInstant().isBefore(trackedFrom);
            return new Funnel(from, to, companyId, trackedFrom, exact, cohort[0], untracked == null ? 0 : untracked,
                    reached, conversions, new TimeToHire(hires == 0 || avg == null ? null : round1(avg.doubleValue()), hires));
        });
    }

    /** The time-to-hire query's arguments in its placeholder order. */
    private static Object[] reorderForHire(UUID tenant, UUID companyId, Timestamp start, Timestamp end) {
        List<Object> out = args(tenant, companyId);
        out.add(tenant);
        out.add(start);
        out.add(end);
        return out.toArray();
    }

    // ── BW-68 my interviews ──────────────────────────────────────────────────

    /** The signed-in interviewer's quarter. Interviews come from V143.20 tables, so this never needs V143.59. */
    @Transactional(readOnly = true)
    public MyInterviews myInterviews(UUID employeeId, LocalDate today) {
        LocalDate qStart = quarterStart(today);
        LocalDate qEnd = qStart.plusMonths(3).minusDays(1);
        if (employeeId == null) return new MyInterviews(qStart, qEnd, 0, 0, 0, 0);
        UUID tenant = TenantContext.requireTenantId();
        Timestamp start = Timestamp.from(startOfDay(qStart));
        Timestamp end = Timestamp.from(startOfDay(qEnd.plusDays(1)));
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE i.scheduled_at >= ? AND i.scheduled_at < ? AND i.scheduled_at <= now()) AS took,
                       count(sc.id) FILTER (WHERE sc.submitted_at >= ? AND sc.submitted_at < ?) AS submitted,
                       count(*) FILTER (WHERE i.scheduled_at <= now() AND i.scheduled_at >= now() - interval '60 days'
                                          AND sc.id IS NULL) AS due,
                       count(*) FILTER (WHERE i.scheduled_at > now()) AS upcoming
                  FROM hiring_mgmt.interviews i
                  JOIN hiring_mgmt.interview_interviewers x
                    ON x.interview_id = i.id AND x.tenant_id = i.tenant_id AND x.employee_id = ?
                  LEFT JOIN hiring_mgmt.interview_scorecards sc
                    ON sc.interview_id = i.id AND sc.tenant_id = i.tenant_id AND sc.interviewer_id = x.employee_id
                 WHERE i.tenant_id = ? AND i.status = 'SCHEDULED'
                """, start, end, start, end, employeeId, tenant);
        return new MyInterviews(qStart, qEnd, n(row.get("took")), n(row.get("submitted")), n(row.get("due")), n(row.get("upcoming")));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** First day of the calendar quarter {@code day} falls in. */
    static LocalDate quarterStart(LocalDate day) {
        int firstMonth = ((day.getMonthValue() - 1) / 3) * 3 + 1;
        return LocalDate.of(day.getYear(), firstMonth, 1);
    }

    static Instant startOfDay(LocalDate day) {
        return day.atStartOfDay(IST).toInstant();
    }

    private static List<Object> args(UUID tenant, UUID companyId) {
        List<Object> out = new ArrayList<>();
        out.add(tenant);
        if (companyId != null) out.add(companyId);
        return out;
    }

    private static List<Object> append(List<Object> list, Object value) {
        list.add(value);
        return list;
    }

    private static long n(Object value) {
        return value == null ? 0 : ((Number) value).longValue();
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
