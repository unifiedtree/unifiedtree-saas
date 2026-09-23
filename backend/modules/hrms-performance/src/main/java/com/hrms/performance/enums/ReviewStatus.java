package com.hrms.performance.enums;

/**
 * Lifecycle of a performance review:
 * PENDING → SUBMITTED → ACKNOWLEDGED
 */
public enum ReviewStatus {
    PENDING,
    IN_PROGRESS,
    MISSED,
    SUBMITTED,
    ACKNOWLEDGED
}
