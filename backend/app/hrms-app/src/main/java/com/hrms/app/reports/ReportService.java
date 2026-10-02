package com.hrms.app.reports;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Six canonical HRMS reports — all executed as tenant-scoped read-only queries.
 * Every table in every query is filtered by the request's tenant (bound as a
 * parameter), and RLS on the DB side is a second wall behind it.
 */
@Service
public class ReportService {

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Each day's effective attendance status (w1a, V143.10: the company's timing
     * policy plus reviewers' changes). The attendance summary and late-marks
     * reports count late days from it, so a late arrival inside the company's
     * allowance, or one a reviewer excused, is not reported as late. Optional:
     * without it (unit tests) the reports read the stored record status.
     */
    private com.hrms.attendance.policy.EffectiveDayStatusService effectiveDays;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setEffectiveDays(com.hrms.attendance.policy.EffectiveDayStatusService effectiveDays) {
        this.effectiveDays = effectiveDays;
    }

    private Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> effective(
            java.util.Collection<UUID> employeeIds, LocalDate from, LocalDate to) {
        if (effectiveDays == null || employeeIds.isEmpty() || from == null || to == null) return Map.of();
        return effectiveDays.effectiveStatuses(employeeIds, from, to);
    }

    private static UUID uuid(Object o) {
        return o instanceof UUID u ? u : o == null ? null : UUID.fromString(o.toString());
    }

    /** The request's (or the job's) tenant; every query binds it. */
    static UUID tenant() {
        return TenantContext.requireTenantId();
    }

    /**
     * Each person's employment status on a date, from hrms.employee_status_history
     * (V143_27: fed by a trigger on every status change, backfilled from the
     * record's own dates), and who had an exit recorded by then with a last
     * working day still to come (they count as on notice on that date). Takes
     * five parameters: tenant, asOf, tenant, asOf, asOf. Shared by the
     * headcount report and the diversity report as of a date, so both count the
     * same people on the same day.
     */
    static final String STATUS_ON = """
            status_on AS (
                SELECT DISTINCT ON (h.employee_id) h.employee_id, h.status
                  FROM hrms.employee_status_history h
                 WHERE h.tenant_id = ?
                   AND h.effective_on <= ?
                 ORDER BY h.employee_id, h.effective_on DESC, h.recorded_at DESC
            ),
            -- An exit already recorded by asOf whose last working day is
            -- still to come: that person is serving notice on asOf, even
            -- when they went straight from active to exited.
            leaving_on AS (
                SELECT DISTINCT h.employee_id
                  FROM hrms.employee_status_history h
                 WHERE h.tenant_id = ?
                   AND h.status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                   AND h.effective_on > ?
                   AND (h.recorded_at AT TIME ZONE 'Asia/Kolkata')::date <= ?
            )
            """;

    /**
     * Who is employed on asOf: joined by then, and not gone by then (an exit
     * only ends employment once the status says so and the last working day
     * has passed). Takes two parameters: asOf, asOf. Starts with a space: a
     * text block drops the trailing space of the "AND " it is appended to.
     */
    static final String EMPLOYED_ON = " " + """
            e.date_of_joining <= ?
                  AND NOT (
                        e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                    AND COALESCE(e.last_working_day, e.date_of_termination, DATE '1900-01-01') <= ?
                  )
            """;

    // ── 1. Headcount Report ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> headcountReport(UUID companyId, LocalDate asOf) {
        // Who is employed on asOf. The workforce exit flow records the leaving
        // date in last_working_day and leaves date_of_termination NULL, so the
        // old filter on date_of_termination alone counted every exited person.
        // An exit only ends employment once the status says so: someone on
        // notice with a future last day is still here; a last working day on or
        // before asOf counts as gone (the status already says they left).
        // department_id lets a click open that department's people. (Gender
        // stays in the diversity report, behind its own permission.)
        //
        // The active / notice / probation split is each person's status ON
        // asOf (STATUS_ON), not today's status. Someone whose exit is still to
        // come counts as on notice. Without a history row (should not happen
        // after the backfill) the current status is used, as before.
        String sql = "WITH " + STATUS_ON + """
                SELECT
                    d.id                            AS department_id,
                    d.name                          AS department,
                    COUNT(e.id)                     AS total,
                    SUM(CASE WHEN l.employee_id IS NULL AND COALESCE(s.status, e.employment_status) = 'ACTIVE'    THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN l.employee_id IS NOT NULL OR COALESCE(s.status, e.employment_status)
                                  IN ('NOTICE_PERIOD', 'EXITED', 'TERMINATED', 'RESIGNED') THEN 1 ELSE 0 END) AS on_notice,
                    SUM(CASE WHEN l.employee_id IS NULL AND COALESCE(s.status, e.employment_status) = 'PROBATION' THEN 1 ELSE 0 END) AS probation
                FROM hrms.employees e
                LEFT JOIN status_on s ON s.employee_id = e.id
                LEFT JOIN leaving_on l ON l.employee_id = e.id
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                WHERE e.tenant_id = ?
                  AND e.company_id = ?
                  AND """ + EMPLOYED_ON + """
                GROUP BY d.id, d.name
                ORDER BY total DESC
                """;
        UUID t = tenant();
        return jdbc.queryForList(sql, t, asOf, t, asOf, asOf, t, t, companyId, asOf, asOf);
    }

    // ── 2. Attrition Report ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attritionReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        // One row per month in [from, to], months without exits included, so a
        // trend line has no gaps. An exit is a person whose status is EXITED,
        // TERMINATED or RESIGNED, dated by last_working_day (the workforce exit
        // flow leaves date_of_termination NULL). People still serving notice
        // are not exits yet, even with a last working day set. The split reads
        // the exit type HR records on the exit flow (V143.13): RESIGNATION is a
        // resignation, TERMINATION a termination, every other type (and exits
        // recorded before the type existed) is "other". The legacy RESIGNED /
        // TERMINATED statuses still count when no type is recorded. headcount is who was
        // employed at the month's end (or today, for the current month);
        // attrition_pct is exits over the month's average headcount.
        String sql = """
                WITH people AS (
                    SELECT e.date_of_joining AS joined,
                           COALESCE(e.exit_type,
                                    CASE e.employment_status WHEN 'RESIGNED' THEN 'RESIGNATION'
                                                             WHEN 'TERMINATED' THEN 'TERMINATION' END) AS exit_type,
                           CASE WHEN e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                                THEN COALESCE(e.last_working_day, e.date_of_termination) END AS left_on
                    FROM hrms.employees e
                    WHERE e.tenant_id = ?
                      AND e.company_id = ?
                ), months AS (
                    SELECT m::date AS m_start,
                           LEAST((m + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE) AS m_end
                    FROM generate_series(date_trunc('month', ?::date), date_trunc('month', ?::date), INTERVAL '1 month') AS m
                ), agg AS (
                    SELECT mo.m_start,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end)                                AS exits,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end AND p.exit_type = 'RESIGNATION') AS resignations,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end AND p.exit_type = 'TERMINATION') AS terminations,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end
                                              AND p.exit_type IS DISTINCT FROM 'RESIGNATION'
                                              AND p.exit_type IS DISTINCT FROM 'TERMINATION')                    AS other_exits,
                           COUNT(*) FILTER (WHERE p.joined <  mo.m_start AND (p.left_on IS NULL OR p.left_on >= mo.m_start)) AS opening,
                           COUNT(*) FILTER (WHERE p.joined <= mo.m_end   AND (p.left_on IS NULL OR p.left_on >  mo.m_end))   AS closing
                    FROM months mo
                    LEFT JOIN people p ON TRUE
                    GROUP BY mo.m_start
                )
                SELECT TO_CHAR(m_start, 'YYYY-MM') AS month,
                       exits, resignations, terminations, other_exits,
                       closing AS headcount,
                       COALESCE(ROUND(exits * 100.0 / NULLIF((opening + closing) / 2.0, 0), 2), 0) AS attrition_pct
                FROM agg
                ORDER BY m_start
                """;
        return jdbc.queryForList(sql, tenant(), companyId, fromDate, toDate);
    }

    // ── 3. Attendance Summary Report ─────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attendanceSummaryReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        String sql = """
                SELECT
                    e.id                                                 AS employee_id,
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    COUNT(ar.id)                                         AS present_days,
                    COALESCE(SUM(CASE WHEN ar.attendance_status = 'LATE' THEN 1 ELSE 0 END), 0) AS late_days,
                    COALESCE(ROUND(AVG(ar.work_hours)::numeric, 2), 0)   AS avg_hours,
                    COALESCE(SUM(ar.overtime_minutes), 0)                AS total_overtime_mins
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                LEFT JOIN attendance.records ar
                    ON ar.employee_id = e.id
                   AND ar.tenant_id = ?
                   AND ar.attendance_date BETWEEN ? AND ?
                WHERE e.tenant_id = ?
                  AND e.company_id = ?
                  AND e.employment_status = 'ACTIVE'
                GROUP BY e.id, e.employee_code, e.first_name, e.last_name, d.name
                ORDER BY late_days DESC, e.last_name
                """;
        UUID t = tenant();
        List<Map<String, Object>> rows = jdbc.queryForList(sql, t, t, fromDate, toDate, t, companyId);
        applyEffectiveSummary(rows, effective(
                rows.stream().map(r -> uuid(r.get("employee_id"))).filter(java.util.Objects::nonNull).toList(), fromDate, toDate));
        return rows;
    }

    /**
     * With effective statuses: present_days = days the person came in (present,
     * late or half day; a punch HR rejected doesn't count) and late_days = days
     * that are effectively late. Rows keep their columns (employee_id is only
     * used here) and are re-sorted by late days. Package-visible for tests.
     */
    static void applyEffectiveSummary(List<Map<String, Object>> rows,
                                      Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> eff) {
        for (Map<String, Object> r : rows) {
            UUID id = uuid(r.remove("employee_id"));
            if (eff.isEmpty() || id == null) continue;
            Map<LocalDate, com.hrms.attendance.policy.EffectiveDay> days = eff.getOrDefault(id, Map.of());
            long worked = days.values().stream().filter(com.hrms.attendance.policy.EffectiveDay::worked).count();
            long late = days.values().stream().filter(d -> com.hrms.attendance.policy.EffectiveDay.LATE.equals(d.status())).count();
            r.put("present_days", worked);
            r.put("late_days", late);
        }
        if (!eff.isEmpty()) {
            rows.sort(java.util.Comparator.comparingLong((Map<String, Object> r) -> ((Number) r.get("late_days")).longValue()).reversed());
        }
    }

    /**
     * People who came in on each day of [from, to] (BW-87, the Reports
     * Center's attendance tile), counted exactly as the attendance summary
     * counts present days: the same people (the company's ACTIVE employees),
     * the effective status when the policy service is there (present, late or
     * half day), else one per attendance record. So the days add up to the
     * summary's total present days for the same range. Every day of the range
     * is listed; a day nobody came in has 0.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> attendanceDaily(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        UUID t = tenant();
        Map<LocalDate, Long> perDay = new TreeMap<>();
        for (LocalDate d = fromDate; !d.isAfter(toDate); d = d.plusDays(1)) perDay.put(d, 0L);
        List<UUID> ids = jdbc.queryForList(
                "SELECT e.id FROM hrms.employees e WHERE e.tenant_id = ? AND e.company_id = ? AND e.employment_status = 'ACTIVE'",
                UUID.class, t, companyId);
        Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> eff = effective(ids, fromDate, toDate);
        if (!eff.isEmpty()) {
            countWorkedDays(perDay, ids, eff);
        } else if (!ids.isEmpty()) {
            jdbc.query("""
                    SELECT ar.attendance_date AS day, COUNT(*) AS n
                      FROM attendance.records ar
                      JOIN hrms.employees e ON e.id = ar.employee_id AND e.tenant_id = ?
                     WHERE ar.tenant_id = ?
                       AND e.company_id = ?
                       AND e.employment_status = 'ACTIVE'
                       AND ar.attendance_date BETWEEN ? AND ?
                     GROUP BY ar.attendance_date
                    """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                LocalDate day = rs.getDate("day").toLocalDate();
                long n = rs.getLong("n");
                perDay.computeIfPresent(day, (k, v) -> v + n);
            }, t, t, companyId, fromDate, toDate);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        perDay.forEach((day, n) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", day.toString());
            m.put("present", n);
            out.add(m);
        });
        return out;
    }

    /** Adds each person's worked days (effective status) to their day. Package-visible for tests. */
    static void countWorkedDays(Map<LocalDate, Long> perDay, List<UUID> ids,
                                Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> eff) {
        for (UUID id : ids) {
            for (Map.Entry<LocalDate, com.hrms.attendance.policy.EffectiveDay> d : eff.getOrDefault(id, Map.of()).entrySet()) {
                if (d.getValue().worked()) perDay.computeIfPresent(d.getKey(), (k, v) -> v + 1);
            }
        }
    }

    // ── 4. Leave Balance Report ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> leaveBalanceReport(UUID companyId, int year) {
        String sql = """
                SELECT
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    lt.name                                              AS leave_type,
                    lb.total_entitlement,
                    lb.used,
                    lb.pending,
                    lb.carry_forward,
                    (lb.total_entitlement + lb.carry_forward - lb.used - lb.pending) AS available
                FROM leave_mgmt.leave_balances lb
                JOIN hrms.employees e  ON e.id = lb.employee_id AND e.tenant_id = ?
                JOIN leave_mgmt.leave_types lt ON lt.id = lb.leave_type_id AND lt.tenant_id = ?
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                WHERE lb.tenant_id = ?
                  AND e.company_id = ?
                  AND lb.year = ?
                  AND e.employment_status = 'ACTIVE'
                ORDER BY e.last_name, lt.name
                """;
        UUID t = tenant();
        return jdbc.queryForList(sql, t, t, t, t, companyId, year);
    }

    // ── 5. Late Marks Report ─────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> lateMarksReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        boolean policy = effectiveDays != null;
        // With the policy every checked-in day is a candidate (the policy's start
        // time and grace decide), without it the stored LATE status, as before.
        String sql = """
                SELECT
                    ar.employee_id,
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    ar.attendance_date,
                    ar.late_by_minutes,
                    ar.check_in_at
                FROM attendance.records ar
                JOIN hrms.employees e ON e.id = ar.employee_id AND e.tenant_id = ?
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                WHERE ar.tenant_id = ?
                  AND e.company_id = ?
                  AND ar.attendance_date BETWEEN ? AND ?
                  AND %s
                ORDER BY ar.late_by_minutes DESC, ar.attendance_date
                """.formatted(policy ? "ar.check_in_at IS NOT NULL" : "ar.attendance_status = 'LATE'");
        UUID t = tenant();
        List<Map<String, Object>> rows = jdbc.queryForList(sql, t, t, t, companyId, fromDate, toDate);
        if (!policy) {
            rows.forEach(r -> r.remove("employee_id"));
            return rows;
        }
        return effectiveLateRows(rows, effective(
                rows.stream().map(r -> uuid(r.get("employee_id"))).filter(java.util.Objects::nonNull).distinct().toList(), fromDate, toDate));
    }

    /**
     * Keeps the days that are effectively LATE, with the policy's late minutes,
     * newest-longest first; drops the helper employee_id column. Package-visible for tests.
     */
    static List<Map<String, Object>> effectiveLateRows(List<Map<String, Object>> rows,
                                                       Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> eff) {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Map<String, Object> r : rows) {
            UUID id = uuid(r.remove("employee_id"));
            Object dateObj = r.get("attendance_date");
            LocalDate date = dateObj instanceof java.sql.Date sd ? sd.toLocalDate()
                    : dateObj instanceof LocalDate ld ? ld : dateObj == null ? null : LocalDate.parse(dateObj.toString());
            com.hrms.attendance.policy.EffectiveDay d = id == null || date == null ? null : eff.getOrDefault(id, Map.of()).get(date);
            if (d == null || !com.hrms.attendance.policy.EffectiveDay.LATE.equals(d.status())) continue;
            if (d.lateMinutes() != null) r.put("late_by_minutes", d.lateMinutes());
            out.add(r);
        }
        out.sort(java.util.Comparator.comparingInt((Map<String, Object> r) -> r.get("late_by_minutes") instanceof Number n ? n.intValue() : 0)
                .reversed());
        return out;
    }

    // ── 6. Org Diversity Report ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> diversityReport(UUID companyId) {
        // Everyone currently employed (active, probation and notice), not just
        // ACTIVE. People without a recorded gender are counted as NOT_SPECIFIED
        // instead of silently disappearing from the totals.
        String sql = """
                SELECT
                    d.id                                                 AS department_id,
                    d.name                                               AS department,
                    COALESCE(e.gender, 'NOT_SPECIFIED')                  AS gender,
                    COUNT(*)                                             AS count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY d.id), 2) AS pct
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                WHERE e.tenant_id = ?
                  AND e.company_id = ?
                  AND e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD')
                GROUP BY d.id, d.name, COALESCE(e.gender, 'NOT_SPECIFIED')
                ORDER BY d.name, count DESC
                """;
        UUID t = tenant();
        return jdbc.queryForList(sql, t, t, companyId);
    }

    /**
     * The diversity report as of a date (BW-86). The people counted are the
     * ones the headcount report counts as active, on notice or on probation on
     * that date: employed on it (EMPLOYED_ON), with their status on it read
     * from hrms.employee_status_history (STATUS_ON); anyone whose exit was
     * recorded by then with a last day still to come counts as on notice. So
     * the people here always add up to the headcount report's active + on
     * notice + probation for the same date. A null date is today's report,
     * unchanged ({@link #diversityReport(UUID)}).
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> diversityReport(UUID companyId, LocalDate asOf) {
        if (asOf == null) return diversityReport(companyId);
        String sql = "WITH " + STATUS_ON + """
                SELECT
                    d.id                                                 AS department_id,
                    d.name                                               AS department,
                    COALESCE(e.gender, 'NOT_SPECIFIED')                  AS gender,
                    COUNT(*)                                             AS count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY d.id), 2) AS pct
                FROM hrms.employees e
                LEFT JOIN status_on s ON s.employee_id = e.id
                LEFT JOIN leaving_on l ON l.employee_id = e.id
                LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = ?
                WHERE e.tenant_id = ?
                  AND e.company_id = ?
                  AND """ + EMPLOYED_ON + """
                  AND (l.employee_id IS NOT NULL
                       OR COALESCE(s.status, e.employment_status)
                          IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD', 'EXITED', 'TERMINATED', 'RESIGNED'))
                GROUP BY d.id, d.name, COALESCE(e.gender, 'NOT_SPECIFIED')
                ORDER BY d.name, count DESC
                """;
        UUID t = tenant();
        return jdbc.queryForList(sql, t, asOf, t, asOf, asOf, t, t, companyId, asOf, asOf);
    }
}
