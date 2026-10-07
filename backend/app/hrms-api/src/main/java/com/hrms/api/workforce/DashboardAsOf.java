package com.hrms.api.workforce;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The admin dashboard's history view: what was true on a past date. Pure (no
 * database, no clock), so every rule is unit-tested (DashboardAsOfTest); the
 * dashboard endpoints load the rows.
 *
 * <p>Who was on the roll and in which status follows the headcount report
 * ({@code ReportService.headcountReport}), so the "Active employees" tile and
 * the department chart on the same dashboard agree:
 * <ul>
 *   <li>on the roll: joined on or before the date (no joining date: the day the
 *       record was created, {@code DashboardHistory.joinedOrCreated}), and not a
 *       leaver whose last working day (else termination date) is on or before it;</li>
 *   <li>status: the latest entry of {@code hrms.employee_status_history} in force
 *       on the date; an exit already recorded by then but taking effect later
 *       means "on notice"; no history falls back to the current status.</li>
 * </ul>
 * Joiners and leavers count from the first of the date's month up to the date.
 *
 * <p>A past day (owner decision, 6 Oct 2026): a leaver is on the roll through
 * their last working day ({@link #employedThrough}), as on that day's
 * attendance roster ({@link #workedOn}), so Total employees and "N scheduled"
 * count the same people. Today's view keeps {@link #onRoll}: by then the exit
 * is already recorded and today's roster has left them out too.
 */
public final class DashboardAsOf {

    private DashboardAsOf() {}

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final Set<String> EXIT_STATUSES = Set.of("EXITED", "TERMINATED", "RESIGNED");
    private static final LocalDate LONG_AGO = LocalDate.of(1900, 1, 1);

    /** One employee as stored today. */
    public record Person(UUID id, LocalDate joined, String status, LocalDate lastWorkingDay, LocalDate terminated) {}

    /** One row of hrms.employee_status_history. */
    public record Change(UUID employeeId, String status, LocalDate effectiveOn, Instant recordedAt) {}

    public record Headcount(int total, int active, int probation, int onNotice, int joined, int left) {}

    /** The instant the IST day after {@code date} begins: "by the end of the date" is {@code < endOf(date)}. */
    public static Instant endOf(LocalDate date) {
        return date.plusDays(1).atStartOfDay(IST).toInstant();
    }

    /** When a leaver left: last working day, else termination date. Null for anyone not (yet) marked as left. */
    static LocalDate leftOn(Person p) {
        if (p.status() == null || !EXIT_STATUSES.contains(p.status())) return null;
        return p.lastWorkingDay() != null ? p.lastWorkingDay() : p.terminated();
    }

    /** On the roll on {@code date}: had joined, and hadn't left (a leaver's last day counts as gone, as in the headcount report). */
    static boolean onRoll(Person p, LocalDate date) {
        if (p.joined() == null || p.joined().isAfter(date)) return false;
        if (p.status() != null && EXIT_STATUSES.contains(p.status())) {
            LocalDate left = p.lastWorkingDay() != null ? p.lastWorkingDay() : p.terminated() != null ? p.terminated() : LONG_AGO;
            return left.isAfter(date);
        }
        return true;
    }

    /**
     * On the roll on a past {@code date}: had joined, and was still employed that
     * day — a leaver works their last working day (else termination date), as
     * {@link #workedOn}. A leaver with neither date counts as gone, as in {@link #onRoll}.
     */
    static boolean employedThrough(Person p, LocalDate date) {
        if (p.joined() == null || p.joined().isAfter(date)) return false;
        if (p.status() != null && EXIT_STATUSES.contains(p.status())) {
            LocalDate left = p.lastWorkingDay() != null ? p.lastWorkingDay() : p.terminated();
            return left != null && !left.isBefore(date);
        }
        return true;
    }

    /** The person's status on {@code date}: see the class comment. */
    static String statusOn(Person p, List<Change> history, LocalDate date) {
        List<Change> rows = history == null ? List.of() : history;
        boolean leaving = rows.stream().anyMatch(c -> c.status() != null && EXIT_STATUSES.contains(c.status())
                && c.effectiveOn().isAfter(date)
                && c.recordedAt() != null && !c.recordedAt().atZone(IST).toLocalDate().isAfter(date));
        if (leaving) return "NOTICE_PERIOD";
        return rows.stream()
                .filter(c -> !c.effectiveOn().isAfter(date))
                .max(Comparator.comparing(Change::effectiveOn)
                        .thenComparing(Change::recordedAt, Comparator.nullsFirst(Comparator.naturalOrder())))
                .map(Change::status)
                .orElse(p.status());
    }

    /** Headcount on {@code date}, and joiners / leavers from the first of its month up to it. */
    public static Headcount headcount(List<Person> people, Map<UUID, List<Change>> history, LocalDate date) {
        return headcount(people, history, date, false);
    }

    /**
     * {@link #headcount(List, Map, LocalDate)}; with {@code throughLastDay} (a past
     * day) leavers count on their last working day ({@link #employedThrough}).
     */
    public static Headcount headcount(List<Person> people, Map<UUID, List<Change>> history, LocalDate date, boolean throughLastDay) {
        LocalDate monthStart = date.withDayOfMonth(1);
        int total = 0, active = 0, probation = 0, notice = 0, joined = 0, left = 0;
        for (Person p : people) {
            if (p.joined() != null && !p.joined().isBefore(monthStart) && !p.joined().isAfter(date)) joined++;
            LocalDate l = leftOn(p);
            if (l != null && !l.isBefore(monthStart) && !l.isAfter(date)) left++;
            if (!(throughLastDay ? employedThrough(p, date) : onRoll(p, date))) continue;
            total++;
            String s = statusOn(p, history.get(p.id()), date);
            if ("ACTIVE".equals(s)) active++;
            else if ("PROBATION".equals(s)) probation++;
            else if ("NOTICE_PERIOD".equals(s) || EXIT_STATUSES.contains(s)) notice++;
        }
        return new Headcount(total, active, probation, notice, joined, left);
    }

    /** Joiners and leavers of a period (the dashboard's date range). */
    public record Moves(int joined, int left) {}

    /**
     * Joiners (joining date) and leavers (last working day, else termination
     * date) from {@code from} to {@code to}, both included: the counts the
     * month's ones are, over any period.
     */
    public static Moves moves(List<Person> people, LocalDate from, LocalDate to) {
        int joined = 0, left = 0;
        for (Person p : people) {
            if (p.joined() != null && !p.joined().isBefore(from) && !p.joined().isAfter(to)) joined++;
            LocalDate l = leftOn(p);
            if (l != null && !l.isBefore(from) && !l.isAfter(to)) left++;
        }
        return new Moves(joined, left);
    }

    /** Still employed on {@code date} for attendance: a leaver works their last working day. */
    public static boolean workedOn(LocalDate lastDay, LocalDate date) {
        return lastDay == null || !lastDay.isBefore(date);
    }
}
