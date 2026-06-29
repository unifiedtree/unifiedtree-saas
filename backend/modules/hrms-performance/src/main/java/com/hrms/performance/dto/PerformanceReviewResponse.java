package com.hrms.performance.dto;

import com.hrms.performance.enums.ReviewStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PerformanceReviewResponse(
        UUID id,
        UUID cycleId,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID reviewerId,
        String reviewerName,
        ReviewStatus status,
        BigDecimal overallRating,
        String strengths,
        String improvements,
        Instant submittedAt,
        Instant createdAt
) {}
