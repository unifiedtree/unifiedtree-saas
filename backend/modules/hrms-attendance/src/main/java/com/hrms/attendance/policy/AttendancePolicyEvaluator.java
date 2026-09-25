package com.hrms.attendance.policy;

import com.hrms.attendance.service.ShiftTiming;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Pure rules: turns one employee's punches, leave, holidays, shifts and manual
 * changes into each day's {@link EffectiveDay}. No database, no clock — the
 * caller passes "today" (an India business date) so it is unit-testable.
 *
 * <p>Order of rules for a day:
 * <ol>
 *   <li>After today → UPCOMING. Before the person's tracking start or after
 *       their last working day → NOT_TRACKED.</li>
 *   <li>No punch (or the face punch was rejected by HR): approved leave →
 *       ON_LEAVE, holiday → HOLIDAY, weekly off → WEEKLY_OFF, a finished day →
 *       ABSENT, today → NOT_MARKED.</li>
 *   <li>A punch on a weekly off or holiday → PRESENT (worked on a day off).</li>
 *   <li>Checked out: worked under the half-day minimum → ABSENT; under the
 *       full-day minimum → HALF_DAY.</li>
 *   <li>Arrived more than the half-day limit after the start → HALF_DAY.</li>
 *   <li>Arrived after start + grace → late. The first N late arrivals in the
 *       week/month count as PRESENT (the allowance); after that the company's
 *       choice: LATE, HALF_DAY, or LATE counted as loss of pay.</li>
 *   <li>A manual status (set or excused by a reviewer) replaces the result. Days
 *       with a manual status don't use up the allowance.</li>
 * </ol>
 */
public final class AttendancePolicyEvaluator {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private AttendancePolicyEvaluator() {}

    /** Who the days belong to. {@code trackingStart} null = counted from the beginning. */
    public record EmployeeContext(UUID employeeId, LocalDate trackingStart, LocalDate lastWorkingDay,
                                  Set<Integer> weeklyOffs) {}

    /** The shift in force on a day. */
    public record ShiftSlot(String name, LocalTime start, LocalTime end, int graceMinutes) {}

    /** A reviewer's status for a day (SET / EXCUSE). */
    public record ManualStatus(String status, String action, String reason, String byName, Instant at) {}

    /** Everything known about one day. */
    public record DayFacts(LocalDate date, Instant checkIn, Instant checkOut, String attendanceType,
                           boolean onLeave, boolean holiday, ShiftSlot shift, boolean punchRejected,
                           boolean outsideGeofence, Integer distanceMeters, ManualStatus manual) {
        public static DayFacts empty(LocalDate date) {
            return new DayFacts(date, null, null, null, false, false, null, false, false, null, null);
        }
    }

    /** First day of the allowance period that {@code date} falls in. */
    public static LocalDate periodStart(AttendanceTimingPolicy policy, LocalDate date) {
        return policy.lateAllowancePeriod() == AttendanceTimingPolicy.AllowancePeriod.WEEK
                ? date.with(TemporalAdjusters.previousOrSame(policy.weekStart()))
                : date.withDayOfMonth(1);
    }

    /**
     * Evaluates every given day, oldest first. Pass every day from the start of
     * the first allowance period you care about, or the allowance count starts
     * too late.
     */
    public static Map<LocalDate, EffectiveDay> evaluate(EmployeeContext emp, List<DayFacts> days,
                                                        AttendanceTimingPolicy policy, LocalDate today) {
        List<DayFacts> sorted = new ArrayList<>(days);
        sorted.sort(Comparator.comparing(DayFacts::date));
        Map<LocalDate, Integer> lateCount = new HashMap<>();
        Map<LocalDate, EffectiveDay> out = new LinkedHashMap<>();
        for (DayFacts d : sorted) {
            out.put(d.date(), evaluateDay(emp, d, policy, today, lateCount));
        }
        return out;
    }

    private static EffectiveDay evaluateDay(EmployeeContext emp, DayFacts d, AttendanceTimingPolicy policy,
                                            LocalDate today, Map<LocalDate, Integer> lateCount) {
        LocalDate date = d.date();
        B b = new B(emp.employeeId(), date);
        b.attendanceType = d.attendanceType();
        b.punchRejected = d.punchRejected();
        b.outsideGeofence = d.outsideGeofence() && d.checkIn() != null && !d.punchRejected();
        b.distanceMeters = b.outsideGeofence ? d.distanceMeters() : null;
        b.checkIn = d.checkIn();
        b.checkOut = d.checkOut();

        // Expected times: the shift's, or the company start time for people without one.
        ShiftSlot shift = d.shift();
        int grace = shift != null && shift.graceMinutes() > 0 ? shift.graceMinutes() : policy.graceMinutes();
        LocalTime start = shift != null ? shift.start() : policy.defaultStartTime();
        Instant expectedStart = date.atTime(start).atZone(IST).toInstant();
        Instant expectedEnd = shift != null ? ShiftTiming.expectedEnd(date, shift.start(), shift.end()) : null;
        b.shiftName = shift != null ? shift.name() : null;
        b.expectedStart = expectedStart;
        b.expectedEnd = expectedEnd;
        b.grace = grace;

        boolean weeklyOff = emp.weeklyOffs() != null && emp.weeklyOffs().contains(date.getDayOfWeek().getValue());
        boolean hasPunch = d.checkIn() != null && !d.punchRejected();

        if (date.isAfter(today)) {
            b.set(EffectiveDay.UPCOMING, null, null);
            return b.build();
        }
        boolean beforeStart = emp.trackingStart() != null && date.isBefore(emp.trackingStart());
        boolean afterExit = emp.lastWorkingDay() != null && date.isAfter(emp.lastWorkingDay());
        if ((beforeStart || afterExit) && !hasPunch && d.manual() == null) {
            b.set(EffectiveDay.NOT_TRACKED, null, afterExit ? "After the last working day." : "Before attendance was tracked for this person.");
            return b.build();
        }

        if (!hasPunch) {
            String rejected = d.punchRejected() ? "HR rejected the face punch for this day (not this person). " : "";
            if (d.onLeave()) b.set(EffectiveDay.ON_LEAVE, null, rejected + "On approved leave.");
            else if (d.holiday()) b.set(EffectiveDay.HOLIDAY, 1.0, rejected + "Company holiday.");
            else if (weeklyOff) b.set(EffectiveDay.WEEKLY_OFF, 1.0, rejected + "Weekly off.");
            else if (date.isBefore(today)) b.set(EffectiveDay.ABSENT, 0.0, rejected + "No punch and no approved leave.");
            else b.set(EffectiveDay.NOT_MARKED, null, rejected + "No punch yet today.");
            return applyManual(b, d.manual());
        }

        // Punched in.
        long afterStart = Duration.between(expectedStart, d.checkIn()).toMinutes();
        boolean late = afterStart > grace;
        if (late) b.lateMinutes = (int) afterStart;
        Integer worked = d.checkOut() != null && !d.checkOut().isBefore(d.checkIn())
                ? (int) Duration.between(d.checkIn(), d.checkOut()).toMinutes() : null;
        b.workedMinutes = worked;
        if (d.checkOut() != null && expectedEnd != null) {
            long early = Duration.between(d.checkOut(), expectedEnd).toMinutes();
            if (early > policy.earlyLeaveMinutes() && early > 0) {
                b.earlyLeave = true;
                b.earlyByMinutes = (int) early;
            }
        }
        String earlyNote = b.earlyLeave ? " Left " + b.earlyByMinutes + " min before the shift ended." : "";
        String missingOut = d.checkOut() == null && date.isBefore(today) ? " No check-out was recorded." : "";

        if (weeklyOff || d.holiday()) {
            b.set(EffectiveDay.PRESENT, 1.0, (weeklyOff ? "Worked on a weekly off." : "Worked on a holiday.") + earlyNote);
            b.lateMinutes = null;
            return applyManual(b, d.manual());
        }
        if (worked != null && policy.halfDayMinHours() != null && worked < policy.halfDayMinHours() * 60) {
            b.set(EffectiveDay.ABSENT, 0.0, "Worked " + hm(worked) + ", under the " + hours(policy.halfDayMinHours())
                    + " minimum for a half day." + earlyNote);
            return applyManual(b, d.manual());
        }
        if (worked != null && policy.fullDayMinHours() != null && worked < policy.fullDayMinHours() * 60) {
            b.set(EffectiveDay.HALF_DAY, 0.5, "Worked " + hm(worked) + ", under the " + hours(policy.fullDayMinHours())
                    + " minimum for a full day." + earlyNote);
            return applyManual(b, d.manual());
        }
        if (late && policy.halfDayLateMinutes() != null && afterStart > policy.halfDayLateMinutes()) {
            b.set(EffectiveDay.HALF_DAY, 0.5, "Arrived " + afterStart + " min late, past the "
                    + policy.halfDayLateMinutes() + "-minute half-day limit." + earlyNote + missingOut);
            return applyManual(b, d.manual());
        }
        if (!late) {
            b.set(EffectiveDay.PRESENT, 1.0, (earlyNote + missingOut).isBlank() ? null : (earlyNote + missingOut).trim());
            return applyManual(b, d.manual());
        }

        // Late: the allowance decides. A day with a manual status doesn't use it up.
        LocalDate period = periodStart(policy, date);
        int used = lateCount.getOrDefault(period, 0) + 1;
        if (d.manual() == null) lateCount.put(period, used);
        int limit = policy.lateAllowanceCount();
        String per = policy.lateAllowancePeriod() == AttendanceTimingPolicy.AllowancePeriod.WEEK ? "this week" : "this month";
        b.allowanceUsed = used;
        b.allowanceLimit = limit;
        b.allowancePeriod = policy.lateAllowancePeriod().name();
        String lateText = "Late by " + afterStart + " min";
        if (used <= limit) {
            b.withinAllowance = true;
            b.set(EffectiveDay.PRESENT, 1.0, lateText + ", within the late allowance (" + used + " of " + limit + " " + per + ")."
                    + earlyNote + missingOut);
            return applyManual(b, d.manual());
        }
        String used0 = limit > 0 ? " after the allowance of " + limit + " " + per + " was used up" : "";
        switch (policy.afterAllowanceAction()) {
            case HALF_DAY -> b.set(EffectiveDay.HALF_DAY, 0.5, lateText + used0 + ", so it counts as a half day." + earlyNote + missingOut);
            case LOSS_OF_PAY -> {
                b.lossOfPay = true;
                b.set(EffectiveDay.LATE, 0.0, lateText + used0 + ", so it counts as loss of pay." + earlyNote + missingOut);
            }
            default -> b.set(EffectiveDay.LATE, 1.0, lateText + (limit > 0 ? "; the allowance of " + limit + " " + per + " is used up." : ".")
                    + earlyNote + missingOut);
        }
        return applyManual(b, d.manual());
    }

    private static EffectiveDay applyManual(B b, ManualStatus manual) {
        b.computed = b.status;
        if (manual == null || !EffectiveDay.isSettable(manual.status())) return b.build();
        String computedNote = b.note;
        b.manual = true;
        b.manualAction = manual.action();
        b.manualReason = manual.reason();
        b.manualBy = manual.byName();
        b.manualAt = manual.at();
        b.lossOfPay = false;
        b.withinAllowance = false;
        b.status = manual.status();
        b.payable = switch (manual.status()) {
            case EffectiveDay.HALF_DAY -> 0.5;
            case EffectiveDay.ABSENT -> 0.0;
            default -> 1.0;
        };
        String verb = "EXCUSE".equals(manual.action()) ? "Excused" : "Set to " + label(manual.status());
        b.note = verb + (manual.byName() != null ? " by " + manual.byName() : "")
                + (manual.reason() != null && !manual.reason().isBlank() ? ": " + manual.reason().trim() : ".")
                + (computedNote != null && !b.computed.equals(b.status) ? " (The rules said " + label(b.computed).toLowerCase() + ".)" : "");
        return b.build();
    }

    /** "Present", "Half day" … for notes and notifications. */
    public static String label(String status) {
        if (status == null) return "—";
        return switch (status) {
            case EffectiveDay.PRESENT -> "Present";
            case EffectiveDay.LATE -> "Late";
            case EffectiveDay.HALF_DAY -> "Half day";
            case EffectiveDay.ABSENT -> "Absent";
            case EffectiveDay.NOT_MARKED -> "Not marked";
            case EffectiveDay.ON_LEAVE -> "On leave";
            case EffectiveDay.HOLIDAY -> "Holiday";
            case EffectiveDay.WEEKLY_OFF -> "Weekly off";
            case EffectiveDay.UPCOMING -> "Upcoming";
            case EffectiveDay.NOT_TRACKED -> "Not tracked";
            default -> status;
        };
    }

    static String hm(int minutes) {
        return (minutes / 60) + "h " + String.format("%02d", minutes % 60) + "m";
    }

    static String hours(double h) {
        return (h == Math.rint(h) ? String.valueOf((long) h) : String.valueOf(h)) + "h";
    }

    /** Mutable builder for one day. */
    private static final class B {
        final UUID employeeId;
        final LocalDate date;
        String status, computed, note, attendanceType, shiftName, allowancePeriod, manualAction, manualReason, manualBy;
        Instant checkIn, checkOut, expectedStart, expectedEnd, manualAt;
        Integer lateMinutes, workedMinutes, earlyByMinutes, allowanceUsed, allowanceLimit, distanceMeters, grace;
        boolean earlyLeave, withinAllowance, lossOfPay, manual, punchRejected, outsideGeofence;
        Double payable;

        B(UUID employeeId, LocalDate date) { this.employeeId = employeeId; this.date = date; }

        void set(String s, Double pay, String n) { status = s; payable = pay; note = n; }

        EffectiveDay build() {
            if (computed == null) computed = status;
            return new EffectiveDay(employeeId, date, status, computed, checkIn, checkOut, attendanceType,
                    lateMinutes, workedMinutes, earlyLeave, earlyByMinutes, withinAllowance, allowanceUsed,
                    allowanceLimit, allowancePeriod, lossOfPay, payable, manual, manualAction, manualReason,
                    manualBy, manualAt, punchRejected, outsideGeofence, distanceMeters, shiftName,
                    expectedStart, expectedEnd, grace, note);
        }
    }
}
