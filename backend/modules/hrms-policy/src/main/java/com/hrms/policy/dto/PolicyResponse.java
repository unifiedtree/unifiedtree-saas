package com.hrms.policy.dto;

import com.hrms.policy.enums.PolicyStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record PolicyResponse(
        UUID id,
        UUID companyId,
        String title,
        String category,
        String content,
        String version,
        LocalDate effectiveDate,
        PolicyStatus status,
        // Server-computed: how many employees have acknowledged this policy.
        long acknowledgementCount,
        Instant createdAt
) {}
