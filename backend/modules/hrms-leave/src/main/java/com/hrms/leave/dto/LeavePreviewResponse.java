package com.hrms.leave.dto;

import com.hrms.leave.enums.LeaveDuration;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What applying for this leave would do, before anything is saved
 * (GET /v1/leave/preview, HRMS redesign BW-48): the working days it costs,
 * counted exactly as applying counts them, the balance before and after, who it
 * would go to, and every reason it would be refused. The first reason is the one
 * applying would answer with.
 *
 * @param workingDays      days it would take off the balance (weekly offs and holidays skipped; 0.5 for a half day); null when the dates can't be counted
 * @param balanceAvailable the balance of that type for the year, after pending requests; null when unknown
 * @param balanceAfter     {@code balanceAvailable - workingDays}; null when either is unknown
 * @param approverName     who the request would go to; null when unknown
 * @param canApply         true when there is no blocking reason
 */
public record LeavePreviewResponse(
        UUID leaveTypeId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        LeaveDuration duration,
        Double workingDays,
        Double balanceAvailable,
        Double balanceAfter,
        String approverName,
        boolean canApply,
        List<Refusal> blockingReasons
) {

    /** One reason applying would be refused: the same code and message applying answers with. */
    public record Refusal(String code, String message) {}

    /** This preview with the approver filled in, and an approver refusal (if any) put first, where applying checks it. */
    public LeavePreviewResponse withApprover(String name, Refusal approverRefusal) {
        List<Refusal> reasons = blockingReasons;
        if (approverRefusal != null) {
            java.util.ArrayList<Refusal> all = new java.util.ArrayList<>();
            all.add(approverRefusal);
            all.addAll(blockingReasons);
            reasons = List.copyOf(all);
        }
        return new LeavePreviewResponse(leaveTypeId, leaveTypeName, startDate, endDate, duration, workingDays,
                balanceAvailable, balanceAfter, name, reasons.isEmpty(), reasons);
    }
}
