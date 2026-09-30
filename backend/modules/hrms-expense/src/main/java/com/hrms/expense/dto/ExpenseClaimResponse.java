package com.hrms.expense.dto;

import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.enums.ExpenseStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ExpenseClaimResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        String title,
        BigDecimal totalAmount,
        String currency,
        ExpenseStatus status,
        Instant submittedAt,
        UUID approverId,
        Instant approvedAt,
        String approverComment,
        Instant reimbursedAt,
        String notes,
        Instant createdAt,
        List<ExpenseItemResponse> items,
        // Line items on the claim and how many carry a receipt (list rows carry no items).
        int itemCount,
        int receiptCount,
        // ── Added by the redesign (BW-60). Additive only: the mobile app reads this
        // DTO. Filled by the API layer; null when it could not be worked out. ──
        /** The claimant's department name. */
        String department,
        /** The approver's name (approverId's person). */
        String approverName,
        /** The distinct categories of the claim's lines, in category order. */
        List<ExpenseCategory> categories,
        /** The reimbursement batch the claim sits in (not a cancelled one): its reference and status. */
        String batchReference,
        String batchStatus,
        /** The claim against the company's active expense policies (the same caps as at submit). */
        ExpensePolicyCheck policyCheck
) {

    /** The response as it was before the redesign's fields (they stay null). */
    public ExpenseClaimResponse(UUID id, UUID employeeId, String employeeName, String employeeCode, UUID companyId,
                                String title, BigDecimal totalAmount, String currency, ExpenseStatus status,
                                Instant submittedAt, UUID approverId, Instant approvedAt, String approverComment,
                                Instant reimbursedAt, String notes, Instant createdAt, List<ExpenseItemResponse> items,
                                int itemCount, int receiptCount) {
        this(id, employeeId, employeeName, employeeCode, companyId, title, totalAmount, currency, status, submittedAt,
                approverId, approvedAt, approverComment, reimbursedAt, notes, createdAt, items, itemCount, receiptCount,
                null, null, null, null, null, null);
    }

    /** This response with the redesign's detail fields set. */
    public ExpenseClaimResponse withDetails(String department, String approverName, List<ExpenseCategory> categories,
                                            String batchReference, String batchStatus, ExpensePolicyCheck policyCheck) {
        return new ExpenseClaimResponse(id, employeeId, employeeName, employeeCode, companyId, title, totalAmount,
                currency, status, submittedAt, approverId, approvedAt, approverComment, reimbursedAt, notes, createdAt,
                items, itemCount, receiptCount, department, approverName, categories, batchReference, batchStatus,
                policyCheck);
    }
}
