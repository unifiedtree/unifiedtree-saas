package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.time.LocalDate;

public record ExpenseItemRequest(
        @NotNull ExpenseCategory category,
        String description,
        @NotNull @Positive BigDecimal amount,
        @NotNull LocalDate expenseDate,
        String receiptUrl,
        String merchantName
) {}
