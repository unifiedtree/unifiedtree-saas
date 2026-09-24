package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by ShiftChangeRequestService when an employee requests a shift
 * change. The approver (resolved by the listener, same chain as corrections) is
 * notified so they can approve/reject from the approvals inbox.
 * {@code effectiveDate} is the start date the employee asked for (null on
 * requests from app builds without the date field).
 */
public record ShiftChangeSubmittedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        String requestedShiftName,
        LocalDate effectiveDate
) {}
