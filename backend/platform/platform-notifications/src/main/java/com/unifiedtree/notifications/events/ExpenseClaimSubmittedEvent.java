package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code ExpenseService.submitClaim} after the row is persisted.
 * Consumed AFTER_COMMIT — the approver gets a "review this claim" notification.
 */
public record ExpenseClaimSubmittedEvent(
        UUID claimId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        String title,
        BigDecimal amount,
        String currency
) {}
