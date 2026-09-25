package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code AdvanceService.requestAdvanceOnBehalf} when HR or
 * finance raises a salary advance for an employee. Consumed AFTER_COMMIT: the
 * employee is told an advance was raised in their name and that it still
 * needs approval. (The approver is notified by the usual
 * {@link AdvanceRequestSubmittedEvent}.)
 */
public record AdvanceRaisedOnBehalfEvent(
        UUID advanceId,
        UUID employeeId,
        UUID raisedById,
        UUID tenantId,
        BigDecimal amount,
        Integer repaymentMonths
) {}
