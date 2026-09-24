package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code AdvanceService.decide} on a terminal decision. The
 * requesting employee is notified.
 */
public record AdvanceRequestDecidedEvent(
        UUID advanceId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        BigDecimal amount,
        String comment
) {}
