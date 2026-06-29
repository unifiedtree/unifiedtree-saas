package com.hrms.learning.dto;

import com.hrms.learning.enums.EnrollmentStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record EnrollmentResponse(
        UUID id,
        UUID programId,
        String programTitle,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        EnrollmentStatus status,
        Instant completedAt,
        BigDecimal score,
        Instant createdAt
) {}
