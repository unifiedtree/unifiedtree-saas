package com.hrms.compliance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public record ComplianceItemRequest(
        // Optional — the controller defaults to the creator's company when null.
        UUID companyId,
        @NotBlank String title,
        String category,
        @NotNull LocalDate dueDate,
        String frequency,
        UUID ownerId,
        String notes
) {}
