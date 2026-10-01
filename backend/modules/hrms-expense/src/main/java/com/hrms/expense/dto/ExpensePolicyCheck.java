package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;

import java.math.BigDecimal;
import java.util.List;

/**
 * An expense claim checked against its company's active expense policies
 * (redesign BW-60): the same per-category caps the submit step enforces
 * (the claim's subtotal per category against the tightest active cap), plus
 * whether a policy expects a receipt that a line lacks.
 *
 * <p>{@code result} is one of {@link #OVER_LIMIT}, {@link #RECEIPT_MISSING},
 * {@link #WITHIN} or {@link #NO_POLICY}, worst first. {@code policyName},
 * {@code cap} and {@code category} name the line that decided the result:
 * the first line over its cap, else the first line missing a receipt, else the
 * one covered line when there is exactly one (null when several are covered;
 * {@code lines} then has each).
 */
public record ExpensePolicyCheck(
        String result,
        String policyName,
        BigDecimal cap,
        ExpenseCategory category,
        List<CategoryLine> lines
) {
    public static final String OVER_LIMIT = "OVER_LIMIT";
    public static final String RECEIPT_MISSING = "RECEIPT_MISSING";
    public static final String WITHIN = "WITHIN";
    public static final String NO_POLICY = "NO_POLICY";

    /**
     * One category of the claim: its subtotal, the tightest active cap and the
     * policy that sets it (null: no cap), whether a policy expects receipts, and
     * how many of its lines have none.
     */
    public record CategoryLine(
            ExpenseCategory category,
            BigDecimal subtotal,
            BigDecimal cap,
            String policyName,
            boolean receiptRequired,
            int missingReceipts,
            String result
    ) {}
}
