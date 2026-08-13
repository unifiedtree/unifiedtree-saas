package com.hrms.policy.dto;

import com.hrms.policy.enums.PolicyStatus;
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
        LocalDate effectiveDate,
        // Optional. On create: DRAFT | ACTIVE (default ACTIVE for back-compat
        // with clients that don't send it, but explicit DRAFT is honoured so
        // authors can save work in progress). On update: the field is ignored
        // — updates preserve the current status; DRAFT → ACTIVE happens via
        // POST /publish only. ARCHIVED is set via POST /archive.
        // Unknown values are rejected with HTTP 400 at the controller.
        PolicyStatus status
) {}
