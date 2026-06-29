package com.hrms.compliance.enums;

/**
 * Lifecycle of a compliance calendar item:
 * PENDING → DONE. An open item whose due date has passed is surfaced as OVERDUE
 * (computed server-side at read time; never stored directly).
 */
public enum ComplianceStatus {
    PENDING,
    DONE,
    OVERDUE
}
