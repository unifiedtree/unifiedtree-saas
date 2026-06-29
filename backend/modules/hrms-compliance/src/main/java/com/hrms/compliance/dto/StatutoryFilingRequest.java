package com.hrms.compliance.dto;

import com.hrms.compliance.enums.FilingType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record StatutoryFilingRequest(
        // Optional — the controller defaults to the creator's company when null.
        UUID companyId,
        @NotNull FilingType filingType,
        String period,
        @PositiveOrZero BigDecimal amount,
        @NotNull LocalDate dueDate
) {}
