package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ExpenseClaimResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        String title,
        BigDecimal totalAmount,
        String currency,
        ExpenseStatus status,
        Instant submittedAt,
        UUID approverId,
        Instant approvedAt,
        String approverComment,
        Instant reimbursedAt,
        String notes,
        Instant createdAt,
        List<ExpenseItemResponse> items
) {}
