package com.hrms.integration.enums;

/**
 * Connection state of a third-party integration:
 * DISCONNECTED → CONNECTED (and back); ERROR when a sync/health check fails.
 */
public enum IntegrationStatus {
    CONNECTED,
    DISCONNECTED,
    ERROR
}
