package com.hrms.advance.dto;

import com.hrms.advance.enums.AdvanceStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record AdvanceResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        BigDecimal amount,
        String reason,
        Integer repaymentMonths,
        BigDecimal monthlyDeduction,
        AdvanceStatus status,
        UUID approverId,
        Instant approvedAt,
        String approverComment,
        Instant disbursedAt,
        BigDecimal outstandingAmount,
        Instant createdAt,
        /** Who raised it for the employee (HR / finance); null when the employee asked themselves. */
        UUID raisedById,
        String raisedByName
) {
    /** A request the employee raised themselves (no "raised by"). */
    public AdvanceResponse(UUID id, UUID employeeId, String employeeName, String employeeCode, UUID companyId,
                           BigDecimal amount, String reason, Integer repaymentMonths, BigDecimal monthlyDeduction,
                           AdvanceStatus status, UUID approverId, Instant approvedAt, String approverComment,
                           Instant disbursedAt, BigDecimal outstandingAmount, Instant createdAt) {
        this(id, employeeId, employeeName, employeeCode, companyId, amount, reason, repaymentMonths, monthlyDeduction,
                status, approverId, approvedAt, approverComment, disbursedAt, outstandingAmount, createdAt, null, null);
    }
}
