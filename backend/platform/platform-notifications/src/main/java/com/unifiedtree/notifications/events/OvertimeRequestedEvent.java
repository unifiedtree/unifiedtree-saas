package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published when an employee asks for overtime on a day they choose (DECISIONS 22, V143.66). Their approver is
 * notified. The decision reuses {@link OvertimeDecidedEvent} with the request's id.
 */
public record OvertimeRequestedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        LocalDate onDate,
        int minutes
) {}
