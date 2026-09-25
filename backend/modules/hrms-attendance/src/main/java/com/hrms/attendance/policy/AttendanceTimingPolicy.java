package com.hrms.attendance.policy;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.UUID;

/**
 * One company's attendance timing rules (V143.10, {@code attendance.timing_policies}
 * plus the grace and work-week start that live in {@code settings.hr_configuration}).
 *
 * <ul>
 *   <li>{@code graceMinutes}: a check-in up to this many minutes after the start
 *       time is on time. A shift's own grace wins when it is more than 0.</li>
 *   <li>{@code defaultStartTime}: the start time for people with no shift (the
 *       old hard-coded 09:30 cut-off is 09:15 plus the default 15 minutes).</li>
 *   <li>{@code halfDayLateMinutes}: arriving more than this many minutes after the
 *       start time is a half day (null = off).</li>
 *   <li>{@code fullDayMinHours}: working fewer hours than this is a half day (null = off).</li>
 *   <li>{@code halfDayMinHours}: working fewer hours than this is an absence (null = off).</li>
 *   <li>{@code earlyLeaveMinutes}: leaving more than this many minutes before the
 *       shift ends is an early leave (0 = any time before the end).</li>
 *   <li>{@code lateAllowanceCount} / {@code lateAllowancePeriod}: this many late
 *       arrivals per week or month count as present; after that
 *       {@code afterAllowanceAction} decides.</li>
 * </ul>
 */
public record AttendanceTimingPolicy(
        UUID companyId,
        int graceMinutes,
        LocalTime defaultStartTime,
        Integer halfDayLateMinutes,
        Double fullDayMinHours,
        Double halfDayMinHours,
        int earlyLeaveMinutes,
        int lateAllowanceCount,
        AllowancePeriod lateAllowancePeriod,
        AfterAllowance afterAllowanceAction,
        DayOfWeek weekStart
) {

    public enum AllowancePeriod { WEEK, MONTH }

    /** What a late arrival becomes once the allowance for the period is used up. */
    public enum AfterAllowance { KEEP_LATE, HALF_DAY, LOSS_OF_PAY }

    public static final int DEFAULT_GRACE_MINUTES = 15;
    public static final LocalTime DEFAULT_START = LocalTime.of(9, 15);

    /**
     * The values a company gets before anyone edits its policy. They reproduce
     * the behaviour before the policy existed: late after 09:30 when there is no
     * shift, no half-day or hours rules, no allowance, late stays late.
     */
    public static AttendanceTimingPolicy defaults(UUID companyId) {
        return new AttendanceTimingPolicy(companyId, DEFAULT_GRACE_MINUTES, DEFAULT_START,
                null, null, null, 0, 0, AllowancePeriod.MONTH, AfterAllowance.KEEP_LATE, DayOfWeek.MONDAY);
    }

    public AttendanceTimingPolicy {
        if (defaultStartTime == null) defaultStartTime = DEFAULT_START;
        if (lateAllowancePeriod == null) lateAllowancePeriod = AllowancePeriod.MONTH;
        if (afterAllowanceAction == null) afterAllowanceAction = AfterAllowance.KEEP_LATE;
        if (weekStart == null) weekStart = DayOfWeek.MONDAY;
        graceMinutes = Math.max(0, graceMinutes);
        earlyLeaveMinutes = Math.max(0, earlyLeaveMinutes);
        lateAllowanceCount = Math.max(0, lateAllowanceCount);
    }

    public AttendanceTimingPolicy withGraceAndWeekStart(int grace, DayOfWeek start) {
        return new AttendanceTimingPolicy(companyId, grace, defaultStartTime, halfDayLateMinutes, fullDayMinHours,
                halfDayMinHours, earlyLeaveMinutes, lateAllowanceCount, lateAllowancePeriod, afterAllowanceAction, start);
    }
}
