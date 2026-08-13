package com.hrms.expense.dto;

import jakarta.validation.constraints.NotNull;

/**
 * Body of a manager approve/reject decision on an expense claim.
 *
 * <p>{@code approved} is a wrapper {@link Boolean} + {@code @NotNull} so a
 * missing field returns a 400 validation error rather than silently defaulting
 * to {@code false} — a primitive {@code boolean} would treat "field absent"
 * as "reject", which has actually rejected legitimate claims in QA.
 */
public record ExpenseDecisionRequest(
        @NotNull Boolean approved,
        String comment
) {}
