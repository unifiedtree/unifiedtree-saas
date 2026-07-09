package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published after {@code LeaveService.approveLeave}/{@code approveL1}/
 * {@code approveL2} has persisted the decision. {@code approved} = true means
 * final APPROVED; false means REJECTED at any level. The listener maps to
 * LEAVE_APPROVED or LEAVE_REJECTED for the employee.
 *
 * <p>Only fired for terminal decisions — L1 escalation to L2 does not publish
 * this event (the employee should not see "approved" until L2 signs off).
 */
public record LeaveDecidedEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        String comment
) {}
