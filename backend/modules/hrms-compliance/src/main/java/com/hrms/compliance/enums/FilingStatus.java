package com.hrms.compliance.enums;

/**
 * Lifecycle of a statutory filing:
 * DUE → FILED. A filing recorded after its due date is marked LATE (computed
 * server-side when the filing is recorded).
 */
public enum FilingStatus {
    DUE,
    FILED,
    LATE
}
