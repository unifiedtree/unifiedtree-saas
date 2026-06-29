package com.hrms.performance.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.UUID;

public record ReviewCycleRequest(
        // Optional — the controller defaults to the caller's company when null.
        UUID companyId,
        @NotBlank String name,
        LocalDate periodStart,
        LocalDate periodEnd
) {}
