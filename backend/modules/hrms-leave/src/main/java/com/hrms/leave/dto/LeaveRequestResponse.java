package com.hrms.leave.dto;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.enums.LeaveDuration;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One leave request. The mobile app reads this shape, so fields are only ever
 * added at the end, never renamed or removed.
 *
 * <p>The fields after {@code createdAt} were added for the HRMS redesign
 * (27 Sep 2026, BW-38). Every one of them is optional: null when it isn't
 * known, when the reader may not see it, or when the lookup behind it failed
 * (the request itself is still returned).
 */
public record LeaveRequestResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        String departmentName,
        UUID leaveTypeId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        double totalDays,
        String reason,
        ApprovalStatus status,
        String approverComment,
        Instant approvedAt,
        Instant createdAt,
        // ── redesign additions ──────────────────────────────────────────────
        /** The leave type's short code, e.g. "CL". */
        String leaveTypeCode,
        /** The leave type's category (CASUAL, SICK, EARNED, …), for its colour. */
        String leaveTypeCategory,
        /** FULL_DAY, HALF_DAY_MORNING or HALF_DAY_AFTERNOON. */
        LeaveDuration duration,
        /** The requester's balance of this type for the request's year, after pending requests (this one included while it waits). */
        Double balanceAvailable,
        /** That balance's total: the year's entitlement plus days carried in. */
        Double balanceTotal,
        /** Who the request went to: the assigned approver, or the first-level decider once decided. */
        String approverName,
        /** Who made the latest decision (the second-level approver when there was one); null while nobody has. */
        String decidedByName,
        /** When that latest decision was made. */
        Instant decidedAt,
        /** The second-level (HR) approver, once they decided. */
        String l2ApproverName,
        Instant l2ApprovedAt,
        /** Who applied, when someone applied on the employee's behalf; null when the employee applied. */
        String raisedByName,
        /** Things an approver should check before deciding; only on the approvers' queues, and only while waiting. */
        List<LeaveConflict> conflicts
) {

    /** The original fifteen fields; every redesign field is null. */
    public LeaveRequestResponse(UUID id, UUID employeeId, String employeeName, String employeeCode,
                                String departmentName, UUID leaveTypeId, String leaveTypeName,
                                LocalDate startDate, LocalDate endDate, double totalDays, String reason,
                                ApprovalStatus status, String approverComment, Instant approvedAt,
                                Instant createdAt) {
        this(id, employeeId, employeeName, employeeCode, departmentName, leaveTypeId, leaveTypeName,
                startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt,
                null, null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * One thing to check before deciding.
     *
     * @param kind  TEAM_OVERLAP (people in the requester's department are off, or asked to be off, on some of those days)
     *              or ON_NOTICE (the requester is serving their notice period)
     * @param text  the same, as a short sentence
     * @param names first names of the people concerned (TEAM_OVERLAP), else empty
     */
    public record LeaveConflict(String kind, String text, List<String> names) {}

    /** This request with the leave type's name filled in; everything else unchanged. */
    public LeaveRequestResponse withLeaveTypeName(String name) {
        return new LeaveRequestResponse(id, employeeId, employeeName, employeeCode, departmentName, leaveTypeId, name,
                startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt,
                leaveTypeCode, leaveTypeCategory, duration, balanceAvailable, balanceTotal, approverName,
                decidedByName, decidedAt, l2ApproverName, l2ApprovedAt, raisedByName, conflicts);
    }

    /** This request with the requester's name, code and department filled in; everything else unchanged. */
    public LeaveRequestResponse withRequester(String name, String code, String department) {
        return new LeaveRequestResponse(id, employeeId, name, code, department, leaveTypeId, leaveTypeName,
                startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt,
                leaveTypeCode, leaveTypeCategory, duration, balanceAvailable, balanceTotal, approverName,
                decidedByName, decidedAt, l2ApproverName, l2ApprovedAt, raisedByName, conflicts);
    }

    /** This request with the looked-up details replaced (the original fifteen fields, the duration and the times are kept). */
    public LeaveRequestResponse withDetails(String typeCode, String typeCategory, Double available, Double total,
                                            String approver, String decidedBy, String l2Approver, String raisedBy,
                                            List<LeaveConflict> checks) {
        return new LeaveRequestResponse(id, employeeId, employeeName, employeeCode, departmentName, leaveTypeId,
                leaveTypeName, startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt,
                typeCode, typeCategory, duration, available, total, approver, decidedBy, decidedAt, l2Approver,
                l2ApprovedAt, raisedBy, checks);
    }
}
