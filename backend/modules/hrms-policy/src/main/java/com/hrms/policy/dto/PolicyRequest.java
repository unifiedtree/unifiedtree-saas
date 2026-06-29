package com.hrms.policy.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.UUID;

public record PolicyRequest(
        // Optional — the controller defaults to the caller's company when null.
        UUID companyId,
        @NotBlank String title,
        String category,
        String content,
        // Published document version label, e.g. "v1.0".
        String version,
        LocalDate effectiveDate
) {}
