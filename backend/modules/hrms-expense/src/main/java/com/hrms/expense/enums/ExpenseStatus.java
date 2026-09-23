package com.hrms.expense.enums;

/**
 * Lifecycle of an expense claim:
 * DRAFT → SUBMITTED → (APPROVED | REJECTED) → REIMBURSED
 */
public enum ExpenseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    APPROVED_FOR_PAY,
    REJECTED,
    REIMBURSED
}
