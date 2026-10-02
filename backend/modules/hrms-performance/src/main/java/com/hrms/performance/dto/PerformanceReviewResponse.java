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
        Instant createdAt,
        String cycleName,
        // Redesign BW-81/BW-78 (added fields only; filled by the API layer, null here):
        // SELF, MANAGER, PEER, SKIP_LEVEL or DIRECT_REPORT; the reviewee's department;
        // the date this review is due by, from the cycle's dates.
        String reviewerType,
        String department,
        java.time.LocalDate dueDate
) {
    /** Today's fields only (the extras are null). */
    public PerformanceReviewResponse(UUID id, UUID cycleId, UUID employeeId, String employeeName, String employeeCode,
                                     UUID reviewerId, String reviewerName, ReviewStatus status, BigDecimal overallRating,
                                     String strengths, String improvements, Instant submittedAt, Instant createdAt,
                                     String cycleName) {
        this(id, cycleId, employeeId, employeeName, employeeCode, reviewerId, reviewerName, status, overallRating,
                strengths, improvements, submittedAt, createdAt, cycleName, null, null, null);
    }
}
