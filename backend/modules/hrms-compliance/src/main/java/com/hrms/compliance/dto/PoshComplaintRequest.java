package com.hrms.compliance.dto;

import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public record PoshComplaintRequest(
        // Optional — the controller defaults to the creator's company when null.
        UUID companyId,
        // Optional — a register number is generated server-side when blank.
        String complaintNo,
        @NotNull LocalDate filedDate,
        String severity,
        String description
) {}
