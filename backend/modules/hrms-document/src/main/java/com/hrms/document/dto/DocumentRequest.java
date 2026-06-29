package com.hrms.document.dto;

import com.hrms.document.enums.DocumentCategory;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public record DocumentRequest(
        @NotNull UUID employeeId,
        // Optional — the controller defaults to the employee's company when null.
        UUID companyId,
        @NotBlank String title,
        @NotNull DocumentCategory category,
        @NotBlank String fileUrl,
        LocalDate issuedDate,
        LocalDate expiryDate,
        String notes
) {}
