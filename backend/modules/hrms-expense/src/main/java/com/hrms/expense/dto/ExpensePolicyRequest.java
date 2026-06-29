package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.util.UUID;

public record ExpensePolicyRequest(
        // Optional — the controller defaults to the path/param company when null.
        UUID companyId,
        @NotBlank String name,
        @NotNull ExpenseCategory category,
        BigDecimal maxAmountPerClaim,
        Boolean requiresReceipt,
        Boolean requiresManagerApproval,
        Boolean requiresHrApproval
) {}
