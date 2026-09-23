package com.hrms.performance.enums;

/**
 * Lifecycle of an employee goal:
 * ACTIVE → (COMPLETED | DROPPED)
 */
public enum GoalStatus {
    ACTIVE,
    AT_RISK,
    COMPLETED,
    DROPPED
}
