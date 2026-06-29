package com.hrms.expense.enums;

/**
 * Expense category — shared by policies and individual claim line items.
 * Mirrors the VARCHAR(50) values in expense_mgmt.expense_policies / expense_items.
 */
public enum ExpenseCategory {
    TRAVEL,
    FOOD,
    ACCOMMODATION,
    COMMUNICATION,
    OFFICE_SUPPLIES,
    MEDICAL,
    TRAINING,
    ENTERTAINMENT,
    OTHER
}
