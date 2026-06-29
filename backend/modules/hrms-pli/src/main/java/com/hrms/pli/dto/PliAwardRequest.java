package com.hrms.pli.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.util.UUID;

public record PliAwardRequest(
        @NotNull UUID employeeId,
        // Optional — the controller defaults to the employee's company when null.
        UUID companyId,
        @NotBlank String planName,
        String period,
        @NotNull @Positive BigDecimal amount,
        BigDecimal ratingBasis,
        String notes
) {}
