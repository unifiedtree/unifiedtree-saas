package com.hrms.policy.enums;

/**
 * Lifecycle of an HR policy:
 * DRAFT → ACTIVE → ARCHIVED
 * Only ACTIVE policies are surfaced to employees for reading / acknowledgement.
 *
 * <p>DRAFT was added in Bundle H (2026-08-13) after the QA finding that
 * POST /v1/policy/policies silently promoted every save to ACTIVE, publishing
 * unfinished text to every employee. Authors now pick their status; the
 * DRAFT → ACTIVE transition is an explicit POST /publish call.
 */
public enum PolicyStatus {
    DRAFT,
    ACTIVE,
    ARCHIVED
}
