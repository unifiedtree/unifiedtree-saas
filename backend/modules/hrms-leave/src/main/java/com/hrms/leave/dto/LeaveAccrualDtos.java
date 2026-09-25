package com.hrms.leave.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Wire shapes for leave accrual, the year-end carry forward, the ledger and encashment (V143.23). */
public final class LeaveAccrualDtos {

    private LeaveAccrualDtos() {}

    /** What one accrual run did. */
    public record AccrualRunResult(
            int year,
            /** Balance rows that didn't exist yet and were created. */
            int balancesCreated,
            /** Balances that were topped up by a monthly / quarterly credit. */
            int balancesCredited,
            double daysCredited) {}

    /** One employee × leave type line of the year-end carry forward. */
    public record CarryForwardLine(
            UUID employeeId,
            String employeeName,
            String employeeCode,
            UUID leaveTypeId,
            String leaveTypeName,
            /** Entitlement + carried in − used − pending, at the end of the year. */
            double unused,
            double carried,
            double lapsed,
            /** True when this line was already processed (it is on the ledger). */
            boolean done) {}

    public record CarryForwardPreview(
            int fromYear,
            int toYear,
            List<CarryForwardLine> lines,
            double totalCarried,
            double totalLapsed,
            int alreadyDone) {}

    public record CarryForwardResult(
            int fromYear,
            int toYear,
            /** Lines processed by this run (lines already done are skipped). */
            int processed,
            int skippedAlreadyDone,
            double totalCarried,
            double totalLapsed) {}

    /** A row of the balance audit trail. */
    public record LedgerEntry(
            UUID id,
            UUID employeeId,
            String employeeName,
            String employeeCode,
            UUID leaveTypeId,
            String leaveTypeName,
            int year,
            /** ACCRUAL, CARRY_FORWARD, LAPSE or ENCASHMENT. */
            String kind,
            String period,
            double days,
            String note,
            Instant createdAt,
            String createdBy) {}

    // ── Encashment ───────────────────────────────────────────────────────────

    /** Employee (or HR) asks to cash in unused days of an encashable leave type. */
    public record EncashmentCreateRequest(UUID leaveTypeId, BigDecimal days, String reason) {}

    public record EncashmentDecisionRequest(Boolean approved, String note) {}

    /** What one person can still encash of one leave type this year. */
    public record EncashmentOption(
            UUID leaveTypeId,
            String leaveTypeName,
            int year,
            /** The balance available right now. */
            double available,
            /** The type's yearly limit per person; null = no limit. */
            Integer maxPerYear,
            /** Days already asked for or approved this year (pending, approved or paid). */
            double alreadyRequested,
            /** The most that can be asked for now: min(available, limit − already requested). */
            double canRequest,
            /** One day's pay (monthly Basic ÷ 30), or null when there's no salary structure. */
            BigDecimal perDayRate) {}

    public record EncashmentResponse(
            UUID id,
            UUID employeeId,
            String employeeName,
            String employeeCode,
            UUID leaveTypeId,
            String leaveTypeName,
            int year,
            double days,
            /** PENDING, APPROVED, REJECTED, CANCELLED or PAID. */
            String status,
            String reason,
            boolean raisedByHr,
            String raisedByName,
            String decidedByName,
            Instant decidedAt,
            String decisionNote,
            BigDecimal perDayRate,
            BigDecimal amount,
            UUID payrollRunId,
            Instant paidAt,
            Instant createdAt) {}

    /**
     * An approved encashment waiting to be paid: what the payroll run adds to
     * the employee's earnings. See LeaveEncashmentService#payableFor.
     */
    public record PayableEncashment(
            UUID id,
            UUID employeeId,
            UUID leaveTypeId,
            String leaveTypeName,
            double days,
            BigDecimal perDayRate,
            BigDecimal amount) {}
}
