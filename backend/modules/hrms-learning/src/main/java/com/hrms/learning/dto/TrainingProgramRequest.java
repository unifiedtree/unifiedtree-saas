package com.hrms.learning.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.UUID;

public record TrainingProgramRequest(
        // Optional — the controller defaults to the creator's company when null.
        UUID companyId,
        @NotBlank String title,
        String description,
        String category,
        String trainer,
        LocalDate startDate,
        LocalDate endDate,
        Integer capacity
) {}
