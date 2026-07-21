package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by ShiftChangeRequestService after an approver approves/rejects a
 * shift-change request. The requesting employee is notified of the outcome.
 */
public record ShiftChangeDecidedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        String requestedShiftName,
        String comment
) {}
