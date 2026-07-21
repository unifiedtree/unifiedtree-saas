package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by ShiftChangeRequestService when an employee requests a shift
 * change. The approver (resolved by the listener, same chain as corrections) is
 * notified so they can approve/reject from the approvals inbox.
 */
public record ShiftChangeSubmittedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        String requestedShiftName
) {}
