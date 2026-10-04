package com.hrms.leave.dto;

import java.util.List;
import java.util.UUID;

/**
 * Wire shapes for "Apply to all employees" on a leave type (4 Oct 2026): set
 * everyone's balance for this leave year to what the type gives today. See
 * {@code LeaveEntitlementService}.
 */
public final class LeaveEntitlementDtos {

    private LeaveEntitlementDtos() {}

    /**
     * What applying the type to everyone would do. Changes nothing.
     *
     * @param people     everyone still working in the type's company (on probation, serving notice and on long leave included)
     * @param changing   people whose balance exists and would get a different number of days
     * @param adding     people who have no balance of this type yet this year; they would get one
     * @param unchanged  people whose balance already matches
     * @param belowZero  people (of {@code changing}) who have used or asked for more than the new number, so their balance would show below 0
     * @param changes    the changes grouped by (from, to) days, most people first
     * @param belowZeroPeople who they are (at most 20; {@code belowZero} is the full count)
     * @param ledgerReady whether each change will also be written to the balance audit trail (V143.71 applied)
     */
    public record ApplyPreview(
            UUID leaveTypeId,
            String leaveTypeName,
            int year,
            double annualEntitlement,
            String accrualFrequency,
            int people,
            int changing,
            int adding,
            int unchanged,
            int belowZero,
            List<Change> changes,
            List<BelowZero> belowZeroPeople,
            boolean ledgerReady) {}

    /** {@code people} balances go from {@code from} to {@code to} days. */
    public record Change(double from, double to, int people) {}

    /** Someone whose balance would show below 0: they have used or asked for {@code takenDays}, more than the new days. */
    public record BelowZero(UUID employeeId, String employeeName, String employeeCode, double takenDays, double availableAfter) {}

    /** What applying did. The counts mean the same as the preview's. */
    public record ApplyResult(
            UUID leaveTypeId,
            String leaveTypeName,
            int year,
            double annualEntitlement,
            int people,
            int changed,
            int added,
            int unchanged,
            int belowZero,
            /** True when each change was also written to the balance audit trail. */
            boolean ledgerWritten) {}
}
