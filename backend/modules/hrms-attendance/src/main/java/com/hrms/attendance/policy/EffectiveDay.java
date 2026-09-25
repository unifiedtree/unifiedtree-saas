package com.hrms.attendance.policy;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * An employee-day's effective attendance status: the punch, judged by the
 * company's timing policy, then any manual change a reviewer made.
 *
 * <p>{@code status} is one of {@link EffectiveDay#PRESENT}, {@link #LATE},
 * {@link #HALF_DAY}, {@link #ABSENT}, {@link #NOT_MARKED} (no punch and the day
 * isn't over), {@link #ON_LEAVE}, {@link #HOLIDAY}, {@link #WEEKLY_OFF},
 * {@link #UPCOMING} (a future day) or {@link #NOT_TRACKED} (before the person
 * joined or the company started using attendance, or after they left).
 *
 * <p>{@code payableFraction} is how much of the day counts as worked for pay:
 * 1 for present, late, holiday and weekly off; 0.5 for a half day; 0 for an
 * absence or a late day that counts as loss of pay; null where attendance does
 * not decide (leave — the leave type decides — and days that are not over or
 * not tracked).
 */
public record EffectiveDay(
        UUID employeeId,
        LocalDate date,
        String status,
        /** What the policy alone says (before a manual change). */
        String computedStatus,
        Instant checkIn,
        Instant checkOut,
        String attendanceType,
        /** Minutes after the start time, set only when the arrival was past the grace. */
        Integer lateMinutes,
        Integer workedMinutes,
        boolean earlyLeave,
        Integer earlyByMinutes,
        boolean withinAllowance,
        /** This late arrival's number in the period (1 = first), when it was late. */
        Integer allowanceUsed,
        Integer allowanceLimit,
        String allowancePeriod,
        boolean lossOfPay,
        Double payableFraction,
        boolean manual,
        String manualAction,
        String manualReason,
        String manualBy,
        Instant manualAt,
        boolean punchRejected,
        boolean outsideGeofence,
        Integer distanceMeters,
        String shiftName,
        Instant expectedStart,
        Instant expectedEnd,
        Integer graceMinutes,
        /** Plain-English reason for the status, for people reading it. */
        String note
) {
    public static final String PRESENT = "PRESENT";
    public static final String LATE = "LATE";
    public static final String HALF_DAY = "HALF_DAY";
    public static final String ABSENT = "ABSENT";
    public static final String NOT_MARKED = "NOT_MARKED";
    public static final String ON_LEAVE = "ON_LEAVE";
    public static final String HOLIDAY = "HOLIDAY";
    public static final String WEEKLY_OFF = "WEEKLY_OFF";
    public static final String UPCOMING = "UPCOMING";
    public static final String NOT_TRACKED = "NOT_TRACKED";

    /** A status a reviewer may set by hand. */
    public static boolean isSettable(String s) {
        return PRESENT.equals(s) || LATE.equals(s) || HALF_DAY.equals(s) || ABSENT.equals(s);
    }

    /** Came in, in any form (present, late or half day). */
    public boolean worked() {
        return PRESENT.equals(status) || LATE.equals(status) || HALF_DAY.equals(status);
    }

    public boolean hasPunch() {
        return checkIn != null && !punchRejected;
    }
}
