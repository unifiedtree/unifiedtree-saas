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
        String receiptUrl,
        String merchantName
) {}
