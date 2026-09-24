package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by ShiftChangeRequestService after an approver approves/rejects a
 * shift-change request, or when a request expires unapproved. The requesting
 * employee is notified of the outcome. {@code effectiveDate} is the date the
 * new shift starts (null on rejection).
 */
public record ShiftChangeDecidedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        String requestedShiftName,
        String comment,
        LocalDate effectiveDate
) {}
