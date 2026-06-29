package com.hrms.learning.dto;

import com.hrms.learning.enums.ProgramStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record TrainingProgramResponse(
        UUID id,
        UUID companyId,
        String title,
        String description,
        String category,
        String trainer,
        LocalDate startDate,
        LocalDate endDate,
        Integer capacity,
        ProgramStatus status,
        long enrolledCount,
        Instant createdAt
) {}
