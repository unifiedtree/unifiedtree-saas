package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record ExpenseItemResponse(
        UUID id,
        ExpenseCategory category,
        String description,
        BigDecimal amount,
        LocalDate expenseDate,
        // Stored as "r2://<key>"; the API layer swaps it for a signed link on read
        // (null when storage isn't set up). hasReceipt says one is attached either way.
        String receiptUrl,
        String merchantName,
        boolean hasReceipt
) {}
