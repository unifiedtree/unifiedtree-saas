package com.hrms.api.leave;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Read models for the redesigned Leave pages (HRMS redesign, 27 Sep 2026):
 * approval stats (BW-37), the date-range calendar feed (BW-39), everyone's
 * balances and usage (BW-44) and "colleagues off" for the apply planner
 * (BW-47). Reads only; every query filters the tenant explicitly as well as
 * through row-level security.
 *
 * <p>Scopes follow the lists that exist today, so a count never disagrees with
 * the list it summarises:
 * <ul>
 *   <li>Level-2 approvers (HR / admin, {@code hrms.leave.approve.l2}) see the
 *       whole tenant, like {@code /approvals/pending} and {@code /history}.</li>
 *   <li>Other approvers see the "broadened match" those lists use: requests
 *       routed to them, from their direct reports, or from a department they
 *       head. The waiting count leaves out their own requests, as the pending
 *       list does.</li>
 *   <li>Everyone else sees only themselves.</li>
 * </ul>
 */
@Service
public class LeaveInsightsService {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** At most this many days per calendar / colleagues-off read. */
    static final int MAX_RANGE_DAYS = 62;
    /** A calendar read returns at most this many requests (then says it was cut short). */
    static final int MAX_CALENDAR_ROWS = 2000;
    private static final Set<String> CALENDAR_STATUSES = Set.of("APPROVED", "PENDING", "PENDING_L2");
    /** People who have left. */
    private static final String SEPARATED = "('EXITED','TERMINATED','RESIGNED','RETIRED')";
    /** Requests a manager answers for: the broadened match of findPendingForManager / findDecidedForManager. */
    private static final String MANAGER_MATCH =
            "(lr.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?)";
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");

    private final JdbcTemplate jdbc;

    public LeaveInsightsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── shapes ───────────────────────────────────────────────────────────────

    /** Where a read looked: the whole workspace, an approver's team, or only the caller. */
    public enum Scope { TENANT, TEAM, SELF }

    /**
     * The Approvals tab's stat cards.
     *
     * @param waiting            pending + pendingL2: what the queue shows
     * @param pending            waiting for a first decision
     * @param pendingL2          waiting for HR's decision ("Awaiting HR"); level-2 approvers only, else 0
     * @param newLast24h         of those waiting, asked for in the last 24 hours
     * @param approvedThisMonth  approved (finally) this month, India time
     * @param approvedLastMonth  the same for last month
     * @param avgDecisionHours   average hours from asking to the final decision (approved or rejected) this month; null with no decisions
     * @param onLeaveToday       people on approved leave today
     * @param nextWorkingDay     the next day that is not a weekly off or holiday of the caller's company
     * @param onLeaveNextWorkingDay people on approved leave that day
     * @param months             the last {@code months} months, oldest first
     */
    public record ApprovalStats(Scope scope, long waiting, long pending, long pendingL2, long newLast24h,
                                long approvedThisMonth, long approvedLastMonth, Double avgDecisionHours,
                                Double avgDecisionHoursLastMonth, long onLeaveToday, LocalDate nextWorkingDay,
                                long onLeaveNextWorkingDay, List<MonthStat> months) {}

    /** One month of decisions: approved, all final decisions, and their average time in hours (null with none). */
    public record MonthStat(String month, long approved, long decided, Double avgDecisionHours) {}

    /** One leave request on the calendar. */
    public record CalendarEntry(UUID id, UUID employeeId, String employeeName, String firstName, String departmentName,
                                UUID leaveTypeId, String leaveTypeName, String leaveTypeCode, String leaveTypeCategory,
                                LocalDate startDate, LocalDate endDate, double totalDays, String duration, String status) {}

    public record CalendarFeed(LocalDate from, LocalDate to, Scope scope, List<String> statuses, boolean truncated,
                               List<CalendarEntry> entries) {}

    /** One day with colleagues off: first names only. */
    public record DayOff(LocalDate date, List<String> names) {}

    /**
     * Same-department colleagues on approved leave, per working day.
     *
     * @param inDepartment false when the caller has no department (then {@code days} is empty)
     */
    public record ColleaguesOff(LocalDate from, LocalDate to, boolean inDepartment, List<DayOff> days) {}

    /** One leave type's balance for one person. {@code total} = entitlement + carried in. */
    public record TypeBalance(UUID leaveTypeId, String leaveTypeName, String leaveTypeCode, String category,
                              boolean typeActive, double entitlement, double carryForward, double total, double used,
                              double pending, double available) {}

    public record PersonBalances(UUID employeeId, String employeeName, String employeeCode, String departmentName,
                                 UUID companyId, String employmentStatus, List<TypeBalance> balances) {}

    /** One leave type across everyone: days used and waiting, and days granted (entitlement + carried in). */
    public record TypeUsage(UUID leaveTypeId, String leaveTypeName, String leaveTypeCode, String category,
                            boolean typeActive, double used, double pending, double granted, int people) {}

    public record Usage(int year, UUID companyId, List<TypeUsage> types) {}

    // ── stats (BW-37) ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ApprovalStats approvalStats(UUID callerEmployeeId, boolean levelTwo, int months, LocalDate today) {
        return FeatureNotReady.guard(() -> {
            UUID tenant = tenant();
            int span = Math.max(1, Math.min(months, 24));
            long[] pending = waitingCounts(tenant, "PENDING", levelTwo, callerEmployeeId);
            long[] l2 = levelTwo ? waitingCounts(tenant, "PENDING_L2", true, callerEmployeeId) : new long[]{0, 0};

            YearMonth thisMonth = YearMonth.from(today);
            YearMonth first = thisMonth.minusMonths(span - 1L);
            // Last month is always read, for the "vs last month" figures, even with a one-month series.
            Map<String, MonthStat> byMonth = decisionsByMonth(tenant, levelTwo, callerEmployeeId,
                    span > 1 ? first : thisMonth.minusMonths(1));
            List<MonthStat> series = new ArrayList<>();
            for (YearMonth m = first; !m.isAfter(thisMonth); m = m.plusMonths(1)) {
                String key = m.format(MONTH);
                series.add(byMonth.getOrDefault(key, new MonthStat(key, 0, 0, null)));
            }
            String nowKey = thisMonth.format(MONTH);
            String lastKey = thisMonth.minusMonths(1).format(MONTH);
            MonthStat now = byMonth.getOrDefault(nowKey, new MonthStat(nowKey, 0, 0, null));
            MonthStat last = byMonth.getOrDefault(lastKey, new MonthStat(lastKey, 0, 0, null));

            UUID company = companyOf(callerEmployeeId);
            LocalDate next = nextWorkingDay(company, today);
            long[] away = onLeave(tenant, levelTwo, callerEmployeeId, today, next);
            return new ApprovalStats(levelTwo ? Scope.TENANT : Scope.TEAM,
                    pending[0] + l2[0], pending[0], l2[0], pending[1] + l2[1],
                    now.approved(), last.approved(), now.avgDecisionHours(), last.avgDecisionHours(),
                    away[0], next, away[1], series);
        });
    }

    /** [count, created in the last 24 hours] of one waiting status, in the pending list's scope. */
    private long[] waitingCounts(UUID tenant, String status, boolean levelTwo, UUID me) {
        StringBuilder sql = new StringBuilder("""
                SELECT COUNT(*) AS n,
                       COUNT(*) FILTER (WHERE lr.created_at >= now() - interval '24 hours') AS recent
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                 WHERE lr.tenant_id = ? AND lr.status = ?""");
        List<Object> args = new ArrayList<>(List.of(tenant, status));
        if (!levelTwo) {
            sql.append(" AND lr.employee_id <> ? AND ").append(MANAGER_MATCH);
            args.addAll(List.of(me, me, me, me));
        }
        return jdbc.query(sql.toString(), rs -> rs.next() ? new long[]{rs.getLong("n"), rs.getLong("recent")} : new long[]{0, 0},
                args.toArray());
    }

    /** Final decisions (approved or rejected) per month from {@code first}, India time. */
    private Map<String, MonthStat> decisionsByMonth(UUID tenant, boolean levelTwo, UUID me, YearMonth first) {
        Timestamp since = Timestamp.from(first.atDay(1).atStartOfDay(IST).toInstant());
        StringBuilder sql = new StringBuilder("""
                SELECT to_char(date_trunc('month', COALESCE(lr.l2_approved_at, lr.decision_at) AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS m,
                       COUNT(*) FILTER (WHERE lr.status = 'APPROVED') AS approved,
                       COUNT(*) AS decided,
                       AVG(EXTRACT(EPOCH FROM (COALESCE(lr.l2_approved_at, lr.decision_at) - lr.created_at)) / 3600.0) AS avg_hours
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                 WHERE lr.tenant_id = ? AND lr.status IN ('APPROVED','REJECTED')
                   AND COALESCE(lr.l2_approved_at, lr.decision_at) >= ?""");
        List<Object> args = new ArrayList<>(List.of(tenant, since));
        if (!levelTwo) {
            sql.append(" AND ").append(MANAGER_MATCH);
            args.addAll(List.of(me, me, me));
        }
        sql.append(" GROUP BY 1");
        Map<String, MonthStat> out = new HashMap<>();
        jdbc.query(sql.toString(), rs -> {
            double avg = rs.getDouble("avg_hours");
            Double hours = rs.wasNull() ? null : Math.round(avg * 10) / 10.0;
            String m = rs.getString("m");
            if (m != null) out.put(m, new MonthStat(m, rs.getLong("approved"), rs.getLong("decided"), hours));
        }, args.toArray());
        return out;
    }

    /** [people on approved leave on {@code day1}, on {@code day2}], in the list's scope. */
    private long[] onLeave(UUID tenant, boolean levelTwo, UUID me, LocalDate day1, LocalDate day2) {
        StringBuilder sql = new StringBuilder("""
                SELECT COUNT(DISTINCT lr.employee_id) FILTER (WHERE lr.start_date <= ? AND lr.end_date >= ?) AS d1,
                       COUNT(DISTINCT lr.employee_id) FILTER (WHERE lr.start_date <= ? AND lr.end_date >= ?) AS d2
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                 WHERE lr.tenant_id = ? AND lr.status = 'APPROVED'
                   AND lr.start_date <= ? AND lr.end_date >= ?""");
        LocalDate lo = day1.isBefore(day2) ? day1 : day2;
        LocalDate hi = day1.isBefore(day2) ? day2 : day1;
        List<Object> args = new ArrayList<>(List.of(Date.valueOf(day1), Date.valueOf(day1), Date.valueOf(day2),
                Date.valueOf(day2), tenant, Date.valueOf(hi), Date.valueOf(lo)));
        if (!levelTwo) {
            sql.append(" AND ").append(MANAGER_MATCH);
            args.addAll(List.of(me, me, me));
        }
        return jdbc.query(sql.toString(), rs -> rs.next() ? new long[]{rs.getLong("d1"), rs.getLong("d2")} : new long[]{0, 0},
                args.toArray());
    }

    // ── calendar feed (BW-39) ────────────────────────────────────────────────

    /**
     * Leave requests that touch [{@code from}, {@code to}] with one of
     * {@code statuses} (APPROVED by default; PENDING and PENDING_L2 on request),
     * in the caller's scope: the tenant for level-2 approvers, their team (the
     * broadened match) plus themselves for other approvers, else themselves.
     */
    @Transactional(readOnly = true)
    public CalendarFeed calendar(UUID me, Scope scope, LocalDate from, LocalDate to, List<String> statuses) {
        checkRange(from, to);
        List<String> wanted = calendarStatuses(statuses);
        return FeatureNotReady.guard(() -> {
            StringBuilder sql = new StringBuilder("""
                    SELECT lr.id, lr.employee_id, lr.leave_type_id, lr.start_date, lr.end_date, lr.total_days,
                           lr.duration, lr.status,
                           NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS emp_name,
                           NULLIF(TRIM(COALESCE(e.first_name, '')), '') AS first_name,
                           d.name AS dept_name, lt.name AS type_name, lt.code AS type_code, lt.category AS type_category
                      FROM leave_mgmt.leave_requests lr
                      LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
                      LEFT JOIN hrms.departments d ON d.id = e.department_id
                      LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
                     WHERE lr.tenant_id = ? AND lr.start_date <= ? AND lr.end_date >= ?
                       AND lr.status IN (%s)""".formatted(String.join(",", Collections.nCopies(wanted.size(), "?"))));
            List<Object> args = new ArrayList<>(List.of(tenant(), Date.valueOf(to), Date.valueOf(from)));
            args.addAll(wanted);
            if (scope == Scope.TEAM) {
                sql.append(" AND (lr.employee_id = ? OR ").append(MANAGER_MATCH).append(")");
                args.addAll(List.of(me, me, me, me));
            } else if (scope == Scope.SELF) {
                sql.append(" AND lr.employee_id = ?");
                args.add(me);
            }
            sql.append(" ORDER BY lr.start_date, emp_name, lr.id LIMIT ?");
            args.add(MAX_CALENDAR_ROWS + 1);
            List<CalendarEntry> rows = jdbc.query(sql.toString(), (rs, i) -> new CalendarEntry(
                    rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class), rs.getString("emp_name"),
                    rs.getString("first_name"), rs.getString("dept_name"), rs.getObject("leave_type_id", UUID.class),
                    rs.getString("type_name"), rs.getString("type_code"), rs.getString("type_category"),
                    rs.getDate("start_date").toLocalDate(), rs.getDate("end_date").toLocalDate(),
                    rs.getDouble("total_days"), rs.getString("duration"), rs.getString("status")), args.toArray());
            boolean truncated = rows.size() > MAX_CALENDAR_ROWS;
            return new CalendarFeed(from, to, scope, wanted, truncated,
                    truncated ? List.copyOf(rows.subList(0, MAX_CALENDAR_ROWS)) : rows);
        });
    }

    static List<String> calendarStatuses(List<String> raw) {
        if (raw == null || raw.isEmpty()) return List.of("APPROVED");
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String s : raw) {
            if (s == null) continue;
            for (String part : s.split(",")) {
                String v = part.trim().toUpperCase(Locale.ROOT);
                if (v.isEmpty()) continue;
                if (!CALENDAR_STATUSES.contains(v)) {
                    throw new HrmsException("The calendar shows APPROVED, PENDING and PENDING_L2 requests only.",
                            HttpStatus.BAD_REQUEST, "INVALID_LEAVE_STATUS");
                }
                out.add(v);
            }
        }
        return out.isEmpty() ? List.of("APPROVED") : List.copyOf(out);
    }

    static void checkRange(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new HrmsException("Choose the dates to show (from and to).", HttpStatus.BAD_REQUEST, "INVALID_DATE_RANGE");
        }
        if (to.isBefore(from)) {
            throw new HrmsException("The end date must not be before the start date.", HttpStatus.BAD_REQUEST, "INVALID_DATE_RANGE");
        }
        if (java.time.temporal.ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new HrmsException("Choose at most %d days at a time.".formatted(MAX_RANGE_DAYS), HttpStatus.BAD_REQUEST,
                    "INVALID_DATE_RANGE");
        }
    }

    // ── colleagues off (BW-47) ───────────────────────────────────────────────

    /**
     * For the apply planner: on each working day of [{@code from}, {@code to}],
     * the FIRST NAMES of people in the caller's department who are on APPROVED
     * leave (DECISIONS 16). No leave type, no pending requests, no other detail,
     * never the caller. Weekly offs and holidays of the caller's company are
     * left out (nobody works then anyway). No department: nothing.
     */
    @Transactional(readOnly = true)
    public ColleaguesOff colleaguesOff(UUID me, LocalDate from, LocalDate to) {
        checkRange(from, to);
        return FeatureNotReady.guard(() -> {
            UUID tenant = tenant();
            List<Map<String, Object>> self = jdbc.queryForList(
                    "SELECT department_id, company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?", me, tenant);
            UUID department = self.isEmpty() ? null : (UUID) self.get(0).get("department_id");
            if (department == null) return new ColleaguesOff(from, to, false, List.of());
            UUID company = (UUID) self.get(0).get("company_id");

            List<Away> away = jdbc.query("""
                    SELECT lr.employee_id, TRIM(COALESCE(e.first_name, '')) AS first_name, lr.start_date, lr.end_date
                      FROM leave_mgmt.leave_requests lr
                      JOIN hrms.employees e ON e.id = lr.employee_id
                     WHERE lr.tenant_id = ? AND lr.status = 'APPROVED'
                       AND lr.start_date <= ? AND lr.end_date >= ?
                       AND e.department_id = ? AND e.id <> ?
                       AND e.employment_status NOT IN %s
                     ORDER BY first_name, lr.employee_id
                    """.formatted(SEPARATED), (rs, i) -> new Away(rs.getObject("employee_id", UUID.class),
                            rs.getString("first_name"), rs.getDate("start_date").toLocalDate(), rs.getDate("end_date").toLocalDate()),
                    tenant, Date.valueOf(to), Date.valueOf(from), department, me);
            if (away.isEmpty()) return new ColleaguesOff(from, to, true, List.of());

            return new ColleaguesOff(from, to, true, byDay(away, from, to, weeklyOffs(company), holidays(company, from, to)));
        });
    }

    /** A colleague's approved leave: who (first name only) and when. */
    record Away(UUID person, String firstName, LocalDate start, LocalDate end) {}

    /**
     * The first names off on each day of [{@code from}, {@code to}], skipping
     * weekly offs and holidays; a person once per day; days with nobody left out.
     */
    static List<DayOff> byDay(List<Away> away, LocalDate from, LocalDate to, Set<Integer> offDays, Set<LocalDate> holidays) {
        TreeMap<LocalDate, LinkedHashMap<UUID, String>> byDay = new TreeMap<>();
        for (Away a : away) {
            if (a.firstName() == null || a.firstName().isBlank()) continue;
            LocalDate d = a.start().isBefore(from) ? from : a.start();
            LocalDate last = a.end().isAfter(to) ? to : a.end();
            for (; !d.isAfter(last); d = d.plusDays(1)) {
                if (offDays.contains(d.getDayOfWeek().getValue()) || holidays.contains(d)) continue;
                byDay.computeIfAbsent(d, k -> new LinkedHashMap<>()).putIfAbsent(a.person(), a.firstName().trim());
            }
        }
        List<DayOff> days = new ArrayList<>();
        byDay.forEach((date, people) -> days.add(new DayOff(date, List.copyOf(people.values()))));
        return days;
    }

    // ── everyone's balances and usage (BW-44) ────────────────────────────────

    /**
     * Everyone still working here (on probation, serving notice and on long leave
     * included; not only ACTIVE as the report shows), a page of people at a time,
     * with each person's balances for {@code year}: entitlement, carried in, used,
     * pending and available (after pending), as the leave balance report
     * computes them. Optional company and name / code search. Reads only: it
     * never creates a missing balance.
     */
    @Transactional(readOnly = true)
    public PageResponse<PersonBalances> balances(UUID companyId, int year, String q, int page, int size) {
        checkYear(year);
        int pageNo = Math.max(0, page);
        int pageSize = Math.max(1, Math.min(size, 100));
        return FeatureNotReady.guard(() -> {
            UUID tenant = tenant();
            StringBuilder where = new StringBuilder(
                    " WHERE e.tenant_id = ? AND e.is_active = TRUE AND e.employment_status NOT IN " + SEPARATED);
            List<Object> args = new ArrayList<>(List.of(tenant));
            if (companyId != null) { where.append(" AND e.company_id = ?"); args.add(companyId); }
            String search = q == null ? null : q.trim();
            if (search != null && !search.isEmpty()) {
                if (search.length() > 100) search = search.substring(0, 100);
                String like = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").toLowerCase(Locale.ROOT) + "%";
                where.append(" AND (LOWER(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, ''))) LIKE ?"
                        + " OR LOWER(COALESCE(e.employee_code, '')) LIKE ?)");
                args.add(like);
                args.add(like);
            }
            Long total = jdbc.queryForObject("SELECT COUNT(*) FROM hrms.employees e" + where, Long.class, args.toArray());
            long totalElements = total == null ? 0 : total;
            List<Object> pageArgs = new ArrayList<>(args);
            pageArgs.add(pageSize);
            pageArgs.add((long) pageNo * pageSize);
            List<PersonBalances> people = jdbc.query("""
                    SELECT e.id, e.employee_code, e.company_id, e.employment_status,
                           NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS emp_name,
                           d.name AS dept_name
                      FROM hrms.employees e
                      LEFT JOIN hrms.departments d ON d.id = e.department_id""" + where + " " + """
                     ORDER BY LOWER(COALESCE(e.first_name, '')), LOWER(COALESCE(e.last_name, '')), e.id
                     LIMIT ? OFFSET ?""", (rs, i) -> new PersonBalances(rs.getObject("id", UUID.class),
                    rs.getString("emp_name"), rs.getString("employee_code"), rs.getString("dept_name"),
                    rs.getObject("company_id", UUID.class), rs.getString("employment_status"), new ArrayList<>()),
                    pageArgs.toArray());
            if (!people.isEmpty()) {
                Map<UUID, List<TypeBalance>> byPerson = new HashMap<>();
                people.forEach(p -> byPerson.put(p.employeeId(), p.balances()));
                List<Object> bArgs = new ArrayList<>(List.of(tenant, year));
                people.forEach(p -> bArgs.add(p.employeeId()));
                jdbc.query("""
                        SELECT lb.employee_id, lb.leave_type_id, lt.name, lt.code, lt.category, lt.is_active,
                               lb.total_entitlement, lb.carry_forward, lb.used, lb.pending
                          FROM leave_mgmt.leave_balances lb
                          JOIN leave_mgmt.leave_types lt ON lt.id = lb.leave_type_id
                         WHERE lb.tenant_id = ? AND lb.year = ? AND lb.employee_id IN (%s)
                         ORDER BY lt.name, lt.id
                        """.formatted(String.join(",", Collections.nCopies(people.size(), "?"))), rs -> {
                    List<TypeBalance> list = byPerson.get(rs.getObject("employee_id", UUID.class));
                    if (list == null) return;
                    double ent = rs.getDouble("total_entitlement");
                    double carry = rs.getDouble("carry_forward");
                    double used = rs.getDouble("used");
                    double pendingDays = rs.getDouble("pending");
                    list.add(new TypeBalance(rs.getObject("leave_type_id", UUID.class), rs.getString("name"),
                            rs.getString("code"), rs.getString("category"), rs.getBoolean("is_active"),
                            round2(ent), round2(carry), round2(ent + carry), round2(used), round2(pendingDays),
                            round2(ent + carry - used - pendingDays)));
                }, bArgs.toArray());
            }
            int totalPages = (int) ((totalElements + pageSize - 1) / pageSize);
            boolean last = (long) (pageNo + 1) * pageSize >= totalElements;
            return new PageResponse<>(people, pageNo, pageSize, totalElements, totalPages, last);
        });
    }

    /** Per leave type, over the same people as {@link #balances}: days used, waiting and granted this year. */
    @Transactional(readOnly = true)
    public Usage usage(UUID companyId, int year) {
        checkYear(year);
        return FeatureNotReady.guard(() -> {
            StringBuilder sql = new StringBuilder("""
                    SELECT lt.id, lt.name, lt.code, lt.category, lt.is_active,
                           CAST(COALESCE(SUM(lb.used), 0) AS double precision) AS used,
                           CAST(COALESCE(SUM(lb.pending), 0) AS double precision) AS pending,
                           CAST(COALESCE(SUM(lb.total_entitlement + lb.carry_forward), 0) AS double precision) AS granted,
                           COUNT(DISTINCT lb.employee_id) AS people
                      FROM leave_mgmt.leave_balances lb
                      JOIN leave_mgmt.leave_types lt ON lt.id = lb.leave_type_id
                      JOIN hrms.employees e ON e.id = lb.employee_id
                     WHERE lb.tenant_id = ? AND lb.year = ?
                       AND e.is_active = TRUE AND e.employment_status NOT IN %s""".formatted(SEPARATED));
            List<Object> args = new ArrayList<>(List.of(tenant(), year));
            if (companyId != null) { sql.append(" AND e.company_id = ?"); args.add(companyId); }
            sql.append(" GROUP BY lt.id, lt.name, lt.code, lt.category, lt.is_active ORDER BY lt.name, lt.id");
            List<TypeUsage> types = jdbc.query(sql.toString(), (rs, i) -> new TypeUsage(rs.getObject("id", UUID.class),
                    rs.getString("name"), rs.getString("code"), rs.getString("category"), rs.getBoolean("is_active"),
                    round2(rs.getDouble("used")), round2(rs.getDouble("pending")), round2(rs.getDouble("granted")),
                    rs.getInt("people")), args.toArray());
            return new Usage(year, companyId, types);
        });
    }

    static void checkYear(int year) {
        if (year < 2000 || year > 2100) {
            throw new HrmsException("Year is out of range", HttpStatus.BAD_REQUEST, "INVALID_YEAR");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No workspace is selected.", "TENANT_REQUIRED");
        return t;
    }

    private UUID companyOf(UUID employeeId) {
        List<UUID> rows = jdbc.query("SELECT company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                (rs, i) -> rs.getObject(1, UUID.class), employeeId, tenant());
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * The first day after {@code today} that is neither a weekly off nor a
     * holiday of the company (Monday when nothing is known). Looks two weeks ahead.
     */
    LocalDate nextWorkingDay(UUID companyId, LocalDate today) {
        Set<Integer> off = weeklyOffs(companyId);
        Set<LocalDate> holidays = holidays(companyId, today.plusDays(1), today.plusDays(14));
        for (LocalDate d = today.plusDays(1); !d.isAfter(today.plusDays(14)); d = d.plusDays(1)) {
            if (!off.contains(d.getDayOfWeek().getValue()) && !holidays.contains(d)) return d;
        }
        return today.plusDays(1);
    }

    /** The company's weekly offs (ISO 1=Mon .. 7=Sun) as the leave count reads them; Saturday and Sunday by default. */
    Set<Integer> weeklyOffs(UUID companyId) {
        if (companyId != null) {
            Integer[] days = jdbc.query("SELECT weekend_days FROM settings.hr_configuration WHERE company_id = ?", rs -> {
                if (!rs.next()) return null;
                java.sql.Array a = rs.getArray(1);
                return a == null ? null : (Integer[]) a.getArray();
            }, companyId);
            if (days != null && days.length > 0) {
                Set<Integer> out = new HashSet<>();
                for (Integer d : days) if (d != null && d >= 1 && d <= 7) out.add(d);
                if (!out.isEmpty()) return out;
            }
        }
        return Set.of(DayOfWeek.SATURDAY.getValue(), DayOfWeek.SUNDAY.getValue());
    }

    /** The company's holidays in the range, from the two tables the leave count reads. */
    Set<LocalDate> holidays(UUID companyId, LocalDate from, LocalDate to) {
        Set<LocalDate> out = new HashSet<>();
        if (companyId == null) return out;
        jdbc.query("SELECT holiday_date FROM settings.holiday_calendar "
                        + "WHERE company_id = ? AND is_active = TRUE AND holiday_date BETWEEN ? AND ?",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.add(rs.getDate(1).toLocalDate()),
                companyId, Date.valueOf(from), Date.valueOf(to));
        jdbc.query("SELECT holiday_date FROM leave_mgmt.holiday_calendars "
                        + "WHERE company_id = ? AND holiday_date BETWEEN ? AND ?",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.add(rs.getDate(1).toLocalDate()),
                companyId, Date.valueOf(from), Date.valueOf(to));
        return out;
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
