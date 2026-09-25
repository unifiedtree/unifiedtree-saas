package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by {@code LeaveEncashmentService.create} when a leave encashment
 * request is raised. Raised by the employee: HR is told there is one to
 * decide. Raised by HR for the employee: the employee is told it was raised.
 */
public record LeaveEncashmentSubmittedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        String leaveTypeName,
        double days,
        boolean raisedByHr
) {}
