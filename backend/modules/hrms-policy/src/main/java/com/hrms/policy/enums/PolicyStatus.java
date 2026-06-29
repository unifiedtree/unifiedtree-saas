package com.hrms.policy.enums;

/**
 * Lifecycle of an HR policy:
 * ACTIVE → ARCHIVED
 * Only ACTIVE policies are surfaced to employees for reading / acknowledgement.
 */
public enum PolicyStatus {
    ACTIVE,
    ARCHIVED
}
