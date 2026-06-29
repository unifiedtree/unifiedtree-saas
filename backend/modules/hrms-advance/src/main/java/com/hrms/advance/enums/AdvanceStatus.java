package com.hrms.advance.enums;

/**
 * Lifecycle of a salary advance request:
 * REQUESTED → (APPROVED | REJECTED); APPROVED → DISBURSED → CLOSED
 */
public enum AdvanceStatus {
    REQUESTED,
    APPROVED,
    REJECTED,
    DISBURSED,
    CLOSED
}
