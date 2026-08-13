package com.hrms.advance.dto;

import jakarta.validation.constraints.NotNull;

/**
 * Body of a manager approve/reject decision on an advance request.
 *
 * <p>{@code approved} is a wrapper {@link Boolean} + {@code @NotNull} so a
 * missing field returns a 400 validation error rather than silently defaulting
 * to {@code false} — a primitive {@code boolean} would treat "field absent"
 * as "reject", which has actually rejected legitimate advances in QA.
 */
public record AdvanceDecisionRequest(
        @NotNull Boolean approved,
        String comment
) {}
