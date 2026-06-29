package com.hrms.compliance.dto;

import com.hrms.compliance.enums.ComplianceStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ComplianceItemResponse(
        UUID id,
        UUID companyId,
        String title,
        String category,
        LocalDate dueDate,
        ComplianceStatus status,
        String frequency,
        UUID ownerId,
        String ownerName,
        String ownerCode,
        String notes,
        Instant createdAt
) {}
