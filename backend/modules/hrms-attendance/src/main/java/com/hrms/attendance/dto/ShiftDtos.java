package com.hrms.attendance.dto;

import com.hrms.attendance.enums.ShiftType;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * Wire DTOs for shift-policy management + per-employee shift assignment.
 * Times are wall-clock {@link LocalTime} (serialized "HH:mm:ss"); the mobile
 * client trims to HH:mm for display.
 */
public final class ShiftDtos {

    private ShiftDtos() {}

    /** A shift definition (e.g. "General", 09:00–18:00, 15-min grace). */
    public record ShiftPolicyResponse(
            UUID id,
            String name,
            ShiftType shiftType,
            LocalTime startTime,
            LocalTime endTime,
            int gracePeriodMinutes,
            Double workingHoursPerDay) {}

    /** Create / update a shift definition. */
    public record ShiftPolicyRequest(
            String name,
            ShiftType shiftType,
            LocalTime startTime,
            LocalTime endTime,
            Integer gracePeriodMinutes,
            Double workingHoursPerDay) {}

    /** Assign a shift to an employee. effectiveFrom defaults to today when null. */
    public record AssignShiftRequest(
            UUID shiftPolicyId,
            LocalDate effectiveFrom) {}

    /** The employee's current shift (null policy fields when unassigned). */
    public record EmployeeShiftResponse(
            UUID employeeId,
            UUID shiftPolicyId,
            String shiftName,
            ShiftType shiftType,
            LocalTime startTime,
            LocalTime endTime,
            int gracePeriodMinutes,
            LocalDate effectiveFrom) {}

    // ── Shift-change requests (employee → HR approve) ────────────────────────

    /** Employee submits a request to move to {@code requestedShiftPolicyId}. */
    public record CreateShiftChangeRequest(
            UUID requestedShiftPolicyId,
            String reason) {}

    /** HR/manager decides a request. */
    public record ShiftChangeDecisionRequest(
            boolean approved,
            String comment) {}

    /** A shift-change request row (employeeName resolved client-side, like leave/WFH). */
    public record ShiftChangeRequestResponse(
            UUID id,
            UUID employeeId,
            UUID currentShiftPolicyId,
            String currentShiftName,
            UUID requestedShiftPolicyId,
            String requestedShiftName,
            String reason,
            String status,
            UUID approverId,
            String decisionNote,
            Instant decidedAt,
            Instant createdAt) {}
}
