package com.hrms.hiring.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

import java.util.UUID;

public record JobRequisitionRequest(
        // Optional — the controller defaults to the hiring manager's company when null.
        UUID companyId,
        @NotBlank String title,
        UUID departmentId,
        @Positive Integer openings,
        String employmentType,
        String location,
        String description,
        UUID hiringManagerId
) {}
