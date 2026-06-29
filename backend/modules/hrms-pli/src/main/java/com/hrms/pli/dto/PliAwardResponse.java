package com.hrms.pli.dto;

import com.hrms.pli.enums.PliStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PliAwardResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        String planName,
        String period,
        BigDecimal amount,
        BigDecimal ratingBasis,
        PliStatus status,
        String notes,
        Instant createdAt
) {}
