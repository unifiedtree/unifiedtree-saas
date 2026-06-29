package com.hrms.compliance.dto;

import com.hrms.compliance.enums.PoshStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record PoshComplaintResponse(
        UUID id,
        UUID companyId,
        String complaintNo,
        LocalDate filedDate,
        String severity,
        PoshStatus status,
        String description,
        String resolution,
        LocalDate resolvedDate,
        Instant createdAt
) {}
