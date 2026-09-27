package com.hrms.leave.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One leave balance. The mobile app reads this shape ({@code /v1/leave/overview},
 * {@code /my/balances}), so fields are only ever added at the end.
 *
 * <p>The last three fields are the balance notes added for the HRMS redesign
 * (27 Sep 2026, BW-49). They describe only rules that run today: the monthly /
 * quarterly credit (LeaveAccrualJob), the leave year ending on 31 December, and
 * the year-end carry forward cap. Null when not known.
 */
public record LeaveBalanceResponse(
        UUID id,
        UUID employeeId,
        UUID leaveTypeId,
        String leaveTypeName,
        int year,
        double totalEntitlement,
        double used,
        double pending,
        double carryForward,
        double available,
        // ── redesign additions (balance notes) ─────────────────────────────
        /** The next credit to this balance: days and the date. Null for types credited in one go, and in the last period of the year. */
        NextCredit nextCredit,
        /** The day this leave year ends and the next one starts (1 January). */
        LocalDate resetsOn,
        /** The most unused days that carry into next year; 0 means unused days lapse. */
        Integer carryForwardCap
) {

    /** The original ten fields; the notes are null. */
    public LeaveBalanceResponse(UUID id, UUID employeeId, UUID leaveTypeId, String leaveTypeName, int year,
                                double totalEntitlement, double used, double pending, double carryForward,
                                double available) {
        this(id, employeeId, leaveTypeId, leaveTypeName, year, totalEntitlement, used, pending, carryForward,
                available, null, null, null);
    }

    /** A credit still to come: {@code days} on {@code on}. */
    public record NextCredit(double days, LocalDate on) {}

    /** This balance with the notes filled in. */
    public LeaveBalanceResponse withNotes(NextCredit next, LocalDate resets, Integer cap) {
        return new LeaveBalanceResponse(id, employeeId, leaveTypeId, leaveTypeName, year, totalEntitlement, used,
                pending, carryForward, available, next, resets, cap);
    }
}
