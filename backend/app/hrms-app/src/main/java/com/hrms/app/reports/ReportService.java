package com.hrms.app.reports;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Six canonical HRMS reports — all executed as tenant-scoped read-only queries.
 * RLS on the DB side ensures cross-tenant leakage is impossible even if
 * tenant_id is accidentally omitted from a query.
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
        // asOf, read from hrms.employee_status_history (V143_27: fed by a
        // trigger on every status change, backfilled from the record's own
        // dates), not today's status. Someone whose exit is still to come
        // counts as on notice. Without a history row (should not happen after
        // the backfill) the current status is used, as before.
        String sql = """
                WITH status_on AS (
                    SELECT DISTINCT ON (h.employee_id) h.employee_id, h.status
                      FROM hrms.employee_status_history h
                     WHERE h.effective_on <= ?
                     ORDER BY h.employee_id, h.effective_on DESC, h.recorded_at DESC
                ),
                -- An exit already recorded by asOf whose last working day is
                -- still to come: that person is serving notice on asOf, even
                -- when they went straight from active to exited.
                leaving_on AS (
                    SELECT DISTINCT h.employee_id
                      FROM hrms.employee_status_history h
                     WHERE h.status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                       AND h.effective_on > ?
                       AND (h.recorded_at AT TIME ZONE 'Asia/Kolkata')::date <= ?
                )
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
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.date_of_joining <= ?
                  AND NOT (
                        e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                    AND COALESCE(e.last_working_day, e.date_of_termination, DATE '1900-01-01') <= ?
                  )
                GROUP BY d.id, d.name
                ORDER BY total DESC
                """;
        return jdbc.queryForList(sql, asOf, asOf, asOf, companyId, asOf, asOf);
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
                    WHERE e.company_id = ?
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
        return jdbc.queryForList(sql, companyId, fromDate, toDate);
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
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                LEFT JOIN attendance.records ar
                    ON ar.employee_id = e.id
                   AND ar.attendance_date BETWEEN ? AND ?
                WHERE e.company_id = ?
                  AND e.employment_status = 'ACTIVE'
                GROUP BY e.id, e.employee_code, e.first_name, e.last_name, d.name
                ORDER BY late_days DESC, e.last_name
                """;
        List<Map<String, Object>> rows = jdbc.queryForList(sql, fromDate, toDate, companyId);
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
                JOIN hrms.employees e  ON e.id = lb.employee_id
                JOIN leave_mgmt.leave_types lt ON lt.id = lb.leave_type_id
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND lb.year = ?
                  AND e.employment_status = 'ACTIVE'
                ORDER BY e.last_name, lt.name
                """;
        return jdbc.queryForList(sql, companyId, year);
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
                JOIN hrms.employees e ON e.id = ar.employee_id
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND ar.attendance_date BETWEEN ? AND ?
                  AND %s
                ORDER BY ar.late_by_minutes DESC, ar.attendance_date
                """.formatted(policy ? "ar.check_in_at IS NOT NULL" : "ar.attendance_status = 'LATE'");
        List<Map<String, Object>> rows = jdbc.queryForList(sql, companyId, fromDate, toDate);
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
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD')
                GROUP BY d.id, d.name, COALESCE(e.gender, 'NOT_SPECIFIED')
                ORDER BY d.name, count DESC
                """;
        return jdbc.queryForList(sql, companyId);
    }
}
