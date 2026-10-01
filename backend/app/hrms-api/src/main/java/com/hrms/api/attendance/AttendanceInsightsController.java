package com.hrms.api.attendance;

import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Attendance analytics read models (redesign P-ATT-PLAN):
 * <ul>
 *   <li>BW-20 {@code GET /v1/attendance/dashboard/breakdown?from&to&by=department|branch}: attendance rate, unplanned
 *       absence and average arrival against the shift, per department or branch and overall, with the previous period
 *       for "vs last month".</li>
 *   <li>BW-21 {@code GET /v1/attendance/punctuality?from&to}: who is often late: late days, average delay, worst
 *       weekday, and the previous period's late days.</li>
 * </ul>
 *
 * <p>Both read {@code attendance.team.read} and are scoped like every team read ({@link TeamEmployeeScope}): HR and
 * admins get their company, a manager their team, never the caller. Unlike the company-wide late-marks report
 * ({@code hrms.report.attendance}, which managers lost in V117) they are safe for managers.
 *
 * <p>Every number comes from the effective day status ({@link EffectiveDayStatusService}: the company's timing policy
 * plus reviewers' changes), the same source as the dashboard trend and the late-marks report, so the pages agree.
 * A person's working days are the days that are not their weekly off and not a company holiday (the same weekly-off and
 * holiday rules the status uses). Read-only; no schema of its own.
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance insights", description = "Analytics breakdown and punctuality")
@SecurityRequirement(name = "bearerAuth")
public class AttendanceInsightsController {

    /** Longest period either endpoint answers for (the previous period is as long again). */
    static final int MAX_DAYS = 62;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final TeamEmployeeScope scope;
    private final EffectiveDayStatusService effectiveDays;
    private final JdbcTemplate jdbc;

    public AttendanceInsightsController(TeamEmployeeScope scope, EffectiveDayStatusService effectiveDays, JdbcTemplate jdbc) {
        this.scope = scope;
        this.effectiveDays = effectiveDays;
        this.jdbc = jdbc;
    }

    // ── response shapes ──────────────────────────────────────────────────────

    /**
     * Counts over person-days. Working days are days that are not the person's weekly off or a holiday, before
     * today or today. {@code ratePct} = attended ÷ (attended + absent + not marked), leave left out, as the Overview's
     * "of people expected"; {@code unplannedAbsencePct} = absent ÷ working days. Arrival is measured on attended
     * working days with a shift in force: minutes after the shift's start (negative = before), and the average clock
     * time. Percentages and averages are null when there is nothing to divide by.
     */
    public record Stats(int workingDays, int attendedDays, int lateDays, int leaveDays, int absentDays,
                        int notMarkedDays, Double ratePct, Double unplannedAbsencePct,
                        int arrivals, Double avgArrivalMinutes, String avgArrivalTime) {}

    public record Group(UUID id, String name, int people, Stats current, Stats previous) {}

    public record Breakdown(LocalDate from, LocalDate to, String by, LocalDate previousFrom, LocalDate previousTo,
                            int people, Stats overall, Stats previous, List<Group> groups) {}

    /** One person's late days in the period; weekday is ISO (1 = Monday … 7 = Sunday). */
    public record PunctualityRow(UUID employeeId, String employeeName, String employeeCode, String departmentName,
                                 int lateDays, Double avgDelayMinutes, Integer worstWeekday, int worstWeekdayLateDays,
                                 int previousLateDays) {}

    public record PunctualityTotals(int lateDays, int people, Double avgDelayMinutes, int previousLateDays) {}

    public record Punctuality(LocalDate from, LocalDate to, LocalDate previousFrom, LocalDate previousTo,
                              PunctualityTotals totals, List<PunctualityRow> rows) {}

    // ── BW-20 ────────────────────────────────────────────────────────────────

    @Operation(summary = "Attendance rate, unplanned absence and average arrival per department or branch, with the previous period")
    @GetMapping("/dashboard/breakdown")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    @Transactional(readOnly = true)
    public Breakdown breakdown(@AuthenticationPrincipal Jwt jwt,
                               @RequestParam LocalDate from,
                               @RequestParam LocalDate to,
                               @RequestParam(defaultValue = "department") String by) {
        requireRange(from, to, "BREAKDOWN_RANGE_INVALID");
        String groupBy = by == null ? "department" : by.trim().toLowerCase(java.util.Locale.ROOT);
        if (!groupBy.equals("department") && !groupBy.equals("branch")) {
            throw new BusinessRuleException("Group by department or branch.", "BREAKDOWN_GROUP_INVALID");
        }
        LocalDate[] prev = previousPeriod(from, to);
        List<Employee> team = team(jwt);
        Data data = load(team, prev[0], to);
        Map<UUID, String> groupNames = groupNames(team, groupBy);

        Map<UUID, List<UUID>> members = new LinkedHashMap<>();
        for (Employee e : team) {
            UUID g = "branch".equals(groupBy) ? e.getBranchId() : e.getDepartmentId();
            members.computeIfAbsent(g, k -> new ArrayList<>()).add(e.getId());
        }
        List<UUID> all = team.stream().map(Employee::getId).toList();
        List<Group> groups = new ArrayList<>();
        members.forEach((g, ids) -> groups.add(new Group(g, g == null ? null : groupNames.get(g), ids.size(),
                stats(ids, from, to, data), stats(ids, prev[0], prev[1], data))));
        groups.sort(Comparator.comparing((Group g) -> g.current().ratePct() == null ? -1 : g.current().ratePct()).reversed()
                .thenComparing(g -> g.name() == null ? "￿" : g.name()));
        return new Breakdown(from, to, groupBy, prev[0], prev[1], team.size(),
                stats(all, from, to, data), stats(all, prev[0], prev[1], data), groups);
    }

    // ── BW-21 ────────────────────────────────────────────────────────────────

    @Operation(summary = "Who is often late in the period: late days, average delay, worst weekday, and the previous period")
    @GetMapping("/punctuality")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    @Transactional(readOnly = true)
    public Punctuality punctuality(@AuthenticationPrincipal Jwt jwt,
                                   @RequestParam LocalDate from,
                                   @RequestParam LocalDate to) {
        requireRange(from, to, "PUNCTUALITY_RANGE_INVALID");
        LocalDate[] prev = previousPeriod(from, to);
        List<Employee> team = team(jwt);
        Data data = load(team, prev[0], to);
        Map<UUID, String> departments = groupNames(team, "department");
        return punctuality(team, departments, from, to, prev, data);
    }

    static Punctuality punctuality(List<Employee> team, Map<UUID, String> departments, LocalDate from, LocalDate to,
                                   LocalDate[] prev, Data data) {
        List<PunctualityRow> rows = new ArrayList<>();
        int totalLate = 0, totalPrev = 0;
        long delaySum = 0;
        int delayDays = 0;
        for (Employee e : team) {
            Map<LocalDate, EffectiveDay> days = data.days().getOrDefault(e.getId(), Map.of());
            int late = 0, delayed = 0;
            long delay = 0;
            int[] byWeekday = new int[8];
            long[] delayByWeekday = new long[8];
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                EffectiveDay day = days.get(d);
                if (day == null || !EffectiveDay.LATE.equals(day.status())) continue;
                late++;
                int wd = d.getDayOfWeek().getValue();
                byWeekday[wd]++;
                if (day.lateMinutes() != null) {
                    delay += day.lateMinutes();
                    delayed++;
                    delayByWeekday[wd] += day.lateMinutes();
                }
            }
            int previous = lateDays(days, prev[0], prev[1]);
            totalPrev += previous;
            if (late == 0) continue;
            totalLate += late;
            delaySum += delay;
            delayDays += delayed;
            // Worst weekday: the most late days, then the most minutes late, then the earlier weekday.
            int worst = 0;
            for (int wd = 1; wd <= 7; wd++) {
                if (byWeekday[wd] == 0) continue;
                if (worst == 0 || byWeekday[wd] > byWeekday[worst]
                        || (byWeekday[wd] == byWeekday[worst] && delayByWeekday[wd] > delayByWeekday[worst])) {
                    worst = wd;
                }
            }
            rows.add(new PunctualityRow(e.getId(), name(e), e.getEmployeeCode(),
                    e.getDepartmentId() == null ? null : departments.get(e.getDepartmentId()),
                    late, delayed == 0 ? null : round1((double) delay / delayed),
                    worst == 0 ? null : worst, worst == 0 ? 0 : byWeekday[worst], previous));
        }
        rows.sort(Comparator.comparingInt(PunctualityRow::lateDays).reversed()
                .thenComparing(r -> r.avgDelayMinutes() == null ? 0 : r.avgDelayMinutes(), Comparator.reverseOrder())
                .thenComparing(r -> r.employeeName() == null ? "" : r.employeeName()));
        return new Punctuality(from, to, prev[0], prev[1],
                new PunctualityTotals(totalLate, rows.size(), delayDays == 0 ? null : round1((double) delaySum / delayDays), totalPrev),
                rows);
    }

    private static int lateDays(Map<LocalDate, EffectiveDay> days, LocalDate from, LocalDate to) {
        int n = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            EffectiveDay day = days.get(d);
            if (day != null && EffectiveDay.LATE.equals(day.status())) n++;
        }
        return n;
    }

    // ── shared ───────────────────────────────────────────────────────────────

    /** Everything the numbers are made from: effective days, and each person's weekly offs and holidays. */
    record Data(Map<UUID, Map<LocalDate, EffectiveDay>> days, Map<UUID, Set<Integer>> weeklyOffs,
                Map<UUID, Set<LocalDate>> holidays) {}

    /** The caller's team (company for HR and admins). Nobody for a caller with no employee record. */
    private List<Employee> team(Jwt jwt) {
        try {
            return scope.resolve(jwt, null);
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    private Data load(List<Employee> team, LocalDate from, LocalDate to) {
        if (team.isEmpty()) return new Data(Map.of(), Map.of(), Map.of());
        List<UUID> ids = team.stream().map(Employee::getId).toList();
        Map<UUID, Map<LocalDate, EffectiveDay>> days = effectiveDays.effectiveStatuses(ids, from, to);
        // The same weekly-off rule the effective status uses (resolved on today's shift).
        Map<UUID, Set<Integer>> offs = AttendanceCalendar.resolveWeeklyOffDays(jdbc, ids, EffectiveDayStatusService.today());
        Map<UUID, Set<LocalDate>> byCompany = new HashMap<>();
        Set<UUID> companies = new HashSet<>();
        team.forEach(e -> { if (e.getCompanyId() != null) companies.add(e.getCompanyId()); });
        if (!companies.isEmpty()) {
            List<Object> args = new ArrayList<>(companies);
            args.add(java.sql.Date.valueOf(from));
            args.add(java.sql.Date.valueOf(to));
            jdbc.query("SELECT company_id, holiday_date FROM settings.holiday_calendar WHERE company_id IN (" + in(companies.size())
                            + ") AND is_active = TRUE AND holiday_date BETWEEN ? AND ?",
                    (RowCallbackHandler) rs -> byCompany.computeIfAbsent(rs.getObject("company_id", UUID.class), k -> new HashSet<>())
                            .add(rs.getDate("holiday_date").toLocalDate()), args.toArray());
        }
        Map<UUID, Set<LocalDate>> holidays = new HashMap<>();
        team.forEach(e -> holidays.put(e.getId(), byCompany.getOrDefault(e.getCompanyId(), Set.of())));
        return new Data(days, offs, holidays);
    }

    /** The counts for {@code ids} over [from, to], up to today (a future day has nothing to count). */
    static Stats stats(Collection<UUID> ids, LocalDate from, LocalDate to, Data data) {
        LocalDate today = LocalDate.now(IST);
        LocalDate last = to.isAfter(today) ? today : to;
        int working = 0, attended = 0, late = 0, leave = 0, absent = 0, notMarked = 0, arrivals = 0;
        long arrivalSum = 0;
        double sin = 0, cos = 0;
        for (UUID id : ids) {
            Map<LocalDate, EffectiveDay> days = data.days().getOrDefault(id, Map.of());
            Set<Integer> offs = data.weeklyOffs().getOrDefault(id, AttendanceCalendar.DEFAULT_OFF_DAYS);
            Set<LocalDate> holidays = data.holidays().getOrDefault(id, Set.of());
            for (LocalDate d = from; !d.isAfter(last); d = d.plusDays(1)) {
                if (offs.contains(d.getDayOfWeek().getValue()) || holidays.contains(d)) continue;
                EffectiveDay day = days.get(d);
                if (day == null || day.status() == null) continue;
                switch (day.status()) {
                    case EffectiveDay.PRESENT, EffectiveDay.LATE, EffectiveDay.HALF_DAY -> {
                        working++;
                        attended++;
                        if (EffectiveDay.LATE.equals(day.status())) late++;
                        Integer minutes = arrivalMinutes(day);
                        if (minutes != null) {
                            arrivals++;
                            arrivalSum += minutes;
                            double angle = 2 * Math.PI * clockMinutes(day.checkIn()) / 1440.0;
                            sin += Math.sin(angle);
                            cos += Math.cos(angle);
                        }
                    }
                    case EffectiveDay.ON_LEAVE -> { working++; leave++; }
                    case EffectiveDay.ABSENT -> { working++; absent++; }
                    case EffectiveDay.NOT_MARKED -> { working++; notMarked++; }
                    default -> { /* not tracked, upcoming: not a working day for these numbers */ }
                }
            }
        }
        int expected = attended + absent + notMarked;
        return new Stats(working, attended, late, leave, absent, notMarked,
                expected == 0 ? null : round1(100.0 * attended / expected),
                working == 0 ? null : round1(100.0 * absent / working),
                arrivals, arrivals == 0 ? null : round1((double) arrivalSum / arrivals),
                arrivals == 0 ? null : clock(Math.atan2(sin, cos)));
    }

    /**
     * Minutes from the start of the shift in force to the check-in (negative = early), only with a shift and a punch.
     * A night shift's arrival across midnight is folded into ±12 hours.
     */
    static Integer arrivalMinutes(EffectiveDay day) {
        if (day.shiftName() == null || day.expectedStart() == null || day.checkIn() == null || day.punchRejected()) return null;
        long m = Duration.between(day.expectedStart(), day.checkIn()).toMinutes();
        while (m > 720) m -= 1440;
        while (m < -720) m += 1440;
        return (int) m;
    }

    private static double clockMinutes(Instant at) {
        LocalTime t = at.atZone(IST).toLocalTime();
        return t.getHour() * 60 + t.getMinute();
    }

    /** A mean angle on the 24-hour clock as "HH:mm" (a circular mean, so 23:50 and 00:10 average to 00:00). */
    static String clock(double angle) {
        double minutes = angle / (2 * Math.PI) * 1440.0;
        long m = Math.round(minutes);
        m = ((m % 1440) + 1440) % 1440;
        return "%02d:%02d".formatted(m / 60, m % 60);
    }

    /**
     * The period to compare with. A period inside one month that starts on the 1st ("September so far") compares with
     * the same days of the month before (1–27 August), or the whole month before when it runs to the month's end. Any
     * other period compares with the same number of days just before it.
     */
    static LocalDate[] previousPeriod(LocalDate from, LocalDate to) {
        if (from.getDayOfMonth() == 1 && from.getYear() == to.getYear() && from.getMonth() == to.getMonth()) {
            LocalDate start = from.minusMonths(1);
            LocalDate monthEnd = start.withDayOfMonth(start.lengthOfMonth());
            LocalDate end = to.getDayOfMonth() == to.lengthOfMonth() ? monthEnd : to.minusMonths(1);
            return new LocalDate[]{start, end.isAfter(monthEnd) ? monthEnd : end};
        }
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        return new LocalDate[]{from.minusDays(days), from.minusDays(1)};
    }

    static void requireRange(LocalDate from, LocalDate to, String code) {
        if (from == null || to == null || to.isBefore(from) || ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) {
            throw new BusinessRuleException("Choose a period of 1 to " + MAX_DAYS + " days.", code);
        }
    }

    private Map<UUID, String> groupNames(List<Employee> team, String by) {
        Set<UUID> ids = new HashSet<>();
        team.forEach(e -> { UUID g = "branch".equals(by) ? e.getBranchId() : e.getDepartmentId(); if (g != null) ids.add(g); });
        Map<UUID, String> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        String table = "branch".equals(by) ? "org.branches" : "hrms.departments";
        jdbc.query("SELECT id, name FROM " + table + " WHERE id IN (" + in(ids.size()) + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getString("name")), ids.toArray());
        return out;
    }

    private static String name(Employee e) {
        String n = ((e.getFirstName() == null ? "" : e.getFirstName()) + " " + (e.getLastName() == null ? "" : e.getLastName())).trim();
        return n.isEmpty() ? null : n;
    }

    private static Double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static String in(int n) {
        return String.join(",", Collections.nCopies(n, "?"));
    }
}
