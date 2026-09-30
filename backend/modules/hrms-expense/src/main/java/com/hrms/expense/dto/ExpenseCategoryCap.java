package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;

import java.math.BigDecimal;

/**
 * What a company's active expense policies allow for one category (redesign
 * BW-60, GET /v1/expense/policies/caps): the tightest cap per claim and the
 * policy that sets it (null cap: no limit), and whether any of them expects a
 * receipt. The same merge the submit step uses to refuse a claim over its cap.
 */
public record ExpenseCategoryCap(
        ExpenseCategory category,
        BigDecimal maxAmountPerClaim,
        String policyName,
        boolean requiresReceipt
) {}
