package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code AdvanceService.requestAdvance} after the row is
 * persisted. Consumed AFTER_COMMIT — the approver gets a "review this advance"
 * notification.
 */
public record AdvanceRequestSubmittedEvent(
        UUID advanceId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        BigDecimal amount
) {}
