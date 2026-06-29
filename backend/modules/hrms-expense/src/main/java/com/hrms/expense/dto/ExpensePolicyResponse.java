package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;

import java.math.BigDecimal;
import java.util.UUID;

public record ExpensePolicyResponse(
        UUID id,
        UUID companyId,
        String name,
        ExpenseCategory category,
        BigDecimal maxAmountPerClaim,
        boolean requiresReceipt,
        boolean requiresManagerApproval,
        boolean requiresHrApproval,
        boolean active
) {}
