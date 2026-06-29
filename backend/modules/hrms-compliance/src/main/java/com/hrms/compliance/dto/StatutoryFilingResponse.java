package com.hrms.compliance.dto;

import com.hrms.compliance.enums.FilingStatus;
import com.hrms.compliance.enums.FilingType;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record StatutoryFilingResponse(
        UUID id,
        UUID companyId,
        FilingType filingType,
        String period,
        BigDecimal amount,
        LocalDate dueDate,
        LocalDate filedDate,
        FilingStatus status,
        String referenceNo,
        Instant createdAt
) {}
