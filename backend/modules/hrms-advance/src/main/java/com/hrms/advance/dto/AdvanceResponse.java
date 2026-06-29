package com.hrms.advance.dto;

import com.hrms.advance.enums.AdvanceStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record AdvanceResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        BigDecimal amount,
        String reason,
        Integer repaymentMonths,
        BigDecimal monthlyDeduction,
        AdvanceStatus status,
        UUID approverId,
        Instant approvedAt,
        String approverComment,
        Instant disbursedAt,
        BigDecimal outstandingAmount,
        Instant createdAt
) {}
