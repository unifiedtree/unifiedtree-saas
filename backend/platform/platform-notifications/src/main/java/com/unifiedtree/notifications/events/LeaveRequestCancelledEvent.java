package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code LeaveService.cancelLeave} when an employee cancels their
 * own PENDING/APPROVED leave. The approver is notified (LEAVE_CANCELLED).
 *
 * <p>Named distinctly from the Kafka {@code com.hrms.leave.dto.LeaveCancelledEvent}
 * to avoid an import clash inside {@code LeaveService}.
 */
public record LeaveRequestCancelledEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate
) {}
