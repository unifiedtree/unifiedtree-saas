package com.hrms.learning.enums;

/**
 * Lifecycle of a training program:
 * PLANNED → ONGOING → COMPLETED, or CANCELLED at any point before completion.
 */
public enum ProgramStatus {
    PLANNED,
    ONGOING,
    COMPLETED,
    CANCELLED
}
