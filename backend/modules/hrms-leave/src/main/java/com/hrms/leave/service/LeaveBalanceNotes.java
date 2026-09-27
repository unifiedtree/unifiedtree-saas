package com.hrms.leave.service;

import com.hrms.leave.dto.LeaveBalanceResponse.NextCredit;

import java.time.LocalDate;

/**
 * The notes shown under a leave balance (HRMS redesign, BW-49): the next
 * credit, when the leave year resets, and how much carries forward. Pure
 * functions over the rules that run today, so they can be tested without a
 * database:
 * <ul>
 *   <li>MONTHLY / QUARTERLY types are credited on the 1st of each month /
 *       quarter by LeaveAccrualJob (00:30 IST), up to
 *       {@link LeaveAccrualMath#entitlementToDate}. YEARLY types get the whole
 *       quota on 1 January, so they have no credit during the year.</li>
 *   <li>The leave year is the calendar year: it resets on 1 January.</li>
 *   <li>At year end, unused days carry forward up to the type's cap
 *       ({@link LeaveAccrualMath#carryForward}); the rest lapse.</li>
 * </ul>
 * Nothing here reads columns no code uses (attachment rules, comp-off expiry).
 */
public final class LeaveBalanceNotes {

    private LeaveBalanceNotes() {}

    /**
     * The next credit to a balance of {@code year}, or null when there is none
     * this leave year: a YEARLY type, a year other than the current one, the
     * last month / quarter of the year, someone who hasn't joined by then, or
     * someone the nightly credit skips ({@code credited} false: they have left).
     */
    public static NextCredit nextCredit(String frequency, double annualQuota, LocalDate joined, int year,
                                        LocalDate today, boolean credited) {
        if (!credited || !LeaveAccrualMath.isAccruing(frequency) || year != today.getYear()) return null;
        int periods = LeaveAccrualMath.periodsPerYear(frequency);
        int current = LeaveAccrualMath.periodOf(frequency, today);
        if (current >= periods) return null;
        int next = current + 1;
        LocalDate on = LeaveAccrualMath.MONTHLY.equals(LeaveAccrualMath.normalizeFrequency(frequency))
                ? LocalDate.of(year, next, 1)
                : LocalDate.of(year, (next - 1) * 3 + 1, 1);
        if (joined != null && (joined.getYear() > year
                || (joined.getYear() == year && LeaveAccrualMath.periodOf(frequency, joined) > next))) {
            return null;
        }
        // The same rounding the job uses: what is due on that day minus what is due today.
        double days = LeaveAccrualMath.round2(
                LeaveAccrualMath.entitlementToDate(frequency, annualQuota, joined, year, on)
                        - LeaveAccrualMath.entitlementToDate(frequency, annualQuota, joined, year, today));
        return days > 0 ? new NextCredit(days, on) : null;
    }

    /** The first day of the next leave year. */
    public static LocalDate resetsOn(int year) {
        return LocalDate.of(year + 1, 1, 1);
    }

    /** The most unused days that carry into the next year; 0 when they all lapse (the rule in {@link LeaveAccrualMath#carryForward}). */
    public static int carryForwardCap(boolean carryAllowed, Integer maxDays) {
        return carryAllowed && maxDays != null && maxDays > 0 ? maxDays : 0;
    }

    /** Whether the nightly credit runs for someone with this status (LeaveAccrualService.LIVE). */
    public static boolean creditedStatus(String employmentStatus, boolean active) {
        if (!active || employmentStatus == null) return false;
        return switch (employmentStatus) {
            case "ACTIVE", "PROBATION", "NOTICE_PERIOD", "ON_LEAVE" -> true;
            default -> false;
        };
    }
}
