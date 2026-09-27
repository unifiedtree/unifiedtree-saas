package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code ExpenseService.submitClaimOnBehalf} when HR, finance or
 * an admin raises an expense claim in an employee's name (redesign BW-61).
 * Consumed AFTER_COMMIT: the employee is told a claim was raised for them and
 * that it still needs approval ({@code expense.raised_for_you}). The approver
 * is notified by the usual {@link ExpenseClaimSubmittedEvent}.
 */
public record ExpenseClaimRaisedForYouEvent(
        UUID claimId,
        UUID employeeId,
        UUID raisedById,
        UUID tenantId,
        String title,
        BigDecimal amount,
        String currency
) {}
