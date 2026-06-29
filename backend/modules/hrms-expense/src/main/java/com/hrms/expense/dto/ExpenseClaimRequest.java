package com.hrms.expense.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

public record ExpenseClaimRequest(
        // Optional — the controller defaults to the claimant's company when null.
        UUID companyId,
        @NotBlank String title,
        String currency,
        String notes,
        @NotEmpty @Valid List<ExpenseItemRequest> items
) {}
