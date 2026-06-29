package com.hrms.pli.enums;

/**
 * Lifecycle of a performance-linked incentive award:
 * PROPOSED → (APPROVED | REJECTED); APPROVED → PAID
 */
public enum PliStatus {
    PROPOSED,
    APPROVED,
    PAID,
    REJECTED
}
