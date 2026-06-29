package com.hrms.compliance.enums;

/**
 * POSH (Prevention of Sexual Harassment) complaint lifecycle:
 * RECEIVED → UNDER_INQUIRY → (RESOLVED | DISMISSED).
 */
public enum PoshStatus {
    RECEIVED,
    UNDER_INQUIRY,
    RESOLVED,
    DISMISSED
}
