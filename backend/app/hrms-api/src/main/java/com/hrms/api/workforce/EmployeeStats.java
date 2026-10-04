package com.hrms.api.workforce;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The Workforce figures behind {@code GET /v1/hrms/employees/stats} (redesign
 * BW-90): counts by status, joiners and leavers, notices, probation reviews,
 * exits, attrition and a seven-point headcount trend.
 *
 * <p>Pure (no database, no clock): {@link EmployeeStatsService} loads one row
 * per person and today's date, and {@link #compute} does the counting, so every
 * rule is unit-tested (EmployeeStatsTest). The rules:
 * <ul>
 *   <li><b>counts</b>: people by their status now; {@code total} is everyone on
 *       the roster (the directory's rows).</li>
 *   <li><b>left, exits, attrition</b>: a leaver is someone EXITED, TERMINATED or
 *       RESIGNED, dated by the last working day, else the termination date, as
 *       the attrition report ({@code ReportService.attritionReport}) does.</li>
 *   <li><b>exitedThisYear / terminatedThisYear</b>: EXITED or TERMINATED people
 *       who left in this calendar year, and the TERMINATED ones among them (same
 *       people, same dates), so the difference is who resigned or left otherwise.</li>
 *   <li><b>attrition %</b>: this year's leavers (1 January to today) over the
 *       average of the headcount on 1 January and today, with the report's
 *       opening/closing rules, to two decimals.</li>
 *   <li><b>activeSeries</b>: people on the roll at the end of each of the last
 *       six months, then today; on the roll = joined on or before the day and
 *       not a leaver whose last day is on or before it (the headcount report's
 *       rule, also used by the dashboard's history view).</li>
 * </ul>
 */
public final class EmployeeStats {

    private EmployeeStats() {}

    static final Set<String> LEAVER_STATUSES = Set.of("EXITED", "TERMINATED", "RESIGNED");
    static final Set<String> EXIT_TAB_STATUSES = Set.of("EXITED", "TERMINATED");

    /** One employee as stored today. */
    public record Person(UUID id, String status, LocalDate joined, LocalDate lastWorkingDay,
                         LocalDate terminated, LocalDate noticeStart, LocalDate probationEnd) {}

    public record Counts(long total, long active, long probation, long notice,
                         long suspended, long exited, long terminated) {}

    public record SeriesPoint(LocalDate date, long active) {}

    public record SuspendedSince(UUID employeeId, LocalDate since) {}

    /** The response: field names are the web contract (contracts.ts EmployeeStats). */
    public record Response(Counts counts,
                           long joinedThisMonth,
                           long leftThisMonth,
                           long noticeStartedLast7Days,
                           long probationReviewsDueNextMonth,
                           long exitedThisYear,
                           long terminatedThisYear,
                           BigDecimal attritionPercent,
                           List<SeriesPoint> activeSeries,
                           List<SuspendedSince> suspendedSince) {}

    /** When a leaver left: last working day, else termination date; null for anyone not marked as left. */
    static LocalDate leftOn(Person p) {
        if (p.status() == null || !LEAVER_STATUSES.contains(p.status())) return null;
        return p.lastWorkingDay() != null ? p.lastWorkingDay() : p.terminated();
    }

    /** On the roll at the end of {@code day}: joined by then, and not a leaver whose last day is on or before it. */
    static boolean onRoll(Person p, LocalDate day) {
        if (p.joined() == null || p.joined().isAfter(day)) return false;
        if (p.status() != null && LEAVER_STATUSES.contains(p.status())) {
            LocalDate left = leftOn(p);
            return left != null && left.isAfter(day);
        }
        return true;
    }

    /** Oldest first: the last day of each of the six months before today's, then today. */
    static List<LocalDate> seriesDates(LocalDate today) {
        List<LocalDate> out = new ArrayList<>(7);
        YearMonth month = YearMonth.from(today);
        for (int back = 6; back >= 1; back--) out.add(month.minusMonths(back).atEndOfMonth());
        out.add(today);
        return out;
    }

    /**
     * @param attrition whether the caller may see attrition (hrms.report.attrition); null percent otherwise
     * @param suspendedSince when each suspended person's suspension began (from the status history); may be empty
     */
    public static Response compute(List<Person> people, LocalDate today, boolean attrition,
                                   Map<UUID, LocalDate> suspendedSince) {
        long total = 0, active = 0, probation = 0, notice = 0, suspended = 0, exited = 0, terminated = 0;
        long joinedThisMonth = 0, leftThisMonth = 0, noticeLast7 = 0, reviewsNextMonth = 0, exitedThisYear = 0;
        long terminatedThisYear = 0;
        long yearLeavers = 0, opening = 0, closing = 0;

        LocalDate monthStart = today.withDayOfMonth(1);
        LocalDate weekStart = today.minusDays(6);
        YearMonth nextMonth = YearMonth.from(today).plusMonths(1);
        LocalDate yearStart = today.withDayOfYear(1);
        LocalDate yearEnd = yearStart.plusYears(1).minusDays(1);
        List<UUID> suspendedIds = new ArrayList<>();

        for (Person p : people) {
            total++;
            String s = p.status() == null ? "" : p.status();
            switch (s) {
                case "ACTIVE" -> active++;
                case "PROBATION" -> probation++;
                case "NOTICE_PERIOD" -> notice++;
                case "SUSPENDED" -> { suspended++; suspendedIds.add(p.id()); }
                case "EXITED" -> exited++;
                case "TERMINATED" -> terminated++;
                default -> { /* counted in total only */ }
            }
            if (within(p.joined(), monthStart, today)) joinedThisMonth++;
            LocalDate left = leftOn(p);
            if (within(left, monthStart, today)) leftThisMonth++;
            if (within(p.noticeStart(), weekStart, today)) noticeLast7++;
            if ("PROBATION".equals(s) && p.probationEnd() != null && YearMonth.from(p.probationEnd()).equals(nextMonth)) {
                reviewsNextMonth++;
            }
            if (EXIT_TAB_STATUSES.contains(s) && within(left, yearStart, yearEnd)) {
                exitedThisYear++;
                if ("TERMINATED".equals(s)) terminatedThisYear++;
            }
            // The attrition report's opening / closing / leaver rules, over the year so far.
            if (within(left, yearStart, today)) yearLeavers++;
            if (p.joined() != null && p.joined().isBefore(yearStart) && (left == null || !left.isBefore(yearStart))) opening++;
            if (p.joined() != null && !p.joined().isAfter(today) && (left == null || left.isAfter(today))) closing++;
        }

        BigDecimal attritionPercent = null;
        if (attrition) {
            BigDecimal average = BigDecimal.valueOf(opening + closing).divide(BigDecimal.valueOf(2), 4, RoundingMode.HALF_UP);
            attritionPercent = average.signum() == 0
                    ? BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP)
                    : BigDecimal.valueOf(yearLeavers * 100L).divide(average, 2, RoundingMode.HALF_UP);
        }

        List<SeriesPoint> series = new ArrayList<>(7);
        for (LocalDate day : seriesDates(today)) {
            long n = 0;
            for (Person p : people) if (onRoll(p, day)) n++;
            series.add(new SeriesPoint(day, n));
        }

        List<SuspendedSince> since = new ArrayList<>(suspendedIds.size());
        for (UUID id : suspendedIds) since.add(new SuspendedSince(id, suspendedSince == null ? null : suspendedSince.get(id)));

        return new Response(new Counts(total, active, probation, notice, suspended, exited, terminated),
                joinedThisMonth, leftThisMonth, noticeLast7, reviewsNextMonth, exitedThisYear,
                terminatedThisYear, attritionPercent, List.copyOf(series), List.copyOf(since));
    }

    private static boolean within(LocalDate d, LocalDate from, LocalDate to) {
        return d != null && !d.isBefore(from) && !d.isAfter(to);
    }
}
