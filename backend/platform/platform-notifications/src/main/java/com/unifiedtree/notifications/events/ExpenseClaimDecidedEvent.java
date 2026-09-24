package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code ExpenseService.decide} on a terminal APPROVED / REJECTED
 * decision. The requesting employee is notified.
 */
public record ExpenseClaimDecidedEvent(
        UUID claimId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        String title,
        BigDecimal amount,
        String currency,
        String comment
) {}
