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
        Boolean requiresHrApproval,
        /**
         * 2026-09-09: there was no way back from deactivating a policy. The
         * request record had no active flag and apply() never touched the
         * column, so even a PUT could not restore one — and the SPA's trash
         * icon had no confirm. A single mis-click retired a spend policy
         * permanently, recoverable only by editing the database.
         *
         * Null means "leave as-is", so existing callers are unaffected.
         */
        Boolean isActive
) {}
