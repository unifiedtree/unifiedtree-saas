package com.hrms.expense.dto;

public record ExpenseDecisionRequest(
        boolean approved,
        String comment
) {}
