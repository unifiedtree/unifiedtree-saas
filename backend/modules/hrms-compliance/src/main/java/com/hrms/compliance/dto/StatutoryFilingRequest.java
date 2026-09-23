package com.hrms.compliance.dto;

import com.hrms.compliance.enums.FilingType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record StatutoryFilingRequest(
        // Optional — the controller defaults to the creator's company when null.
        UUID companyId,
        @NotNull FilingType filingType,
        @Size(max = 20, message = "Filing period must not exceed 20 characters") String period,
        @PositiveOrZero BigDecimal amount,
        @NotNull LocalDate dueDate
) {}
