package com.hrms.attendance.dto;

import com.hrms.attendance.enums.ShiftType;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.math.BigDecimal;
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
            Double workingHoursPerDay,
            boolean overtimeApplicable,
            BigDecimal overtimeMultiplier) {}

    /**
     * Create / update a shift definition.
     *
     * <p>Field bounds:
     * <ul>
     *   <li>{@code gracePeriodMinutes} — 0..120 (two-hour ceiling; anything larger
     *       is almost always a data-entry error and defeats the late-mark logic).</li>
     *   <li>{@code workingHoursPerDay} — 0.5..24.0 (half-hour minimum, one full
     *       day maximum). Negative values silently corrupted overtime calc.</li>
     *   <li>{@code overtimeMultiplier} — 1.0..9.99. The column is NUMERIC(4,2)
     *       so it would accept up to 99.99, but an OT rate above 9.99x is a
     *       data-entry error, not a policy. 1.0 = paid at plain time.</li>
     * </ul>
     *
     * <p>{@code overtimeApplicable} / {@code overtimeMultiplier} are stored on
     * the policy only — nothing consumes them yet. Wiring overtime into payroll
     * is deliberately out of scope until the client picks a model (multiplier on
     * base vs a flat per-hour rupee rate).</p>
     *
     * <p>Cross-field {@code endTime > startTime} for {@link ShiftType#FIXED} is
     * enforced in {@code EmployeeShiftService} — a {@link ShiftType#NIGHT} shift
     * is allowed to wrap past midnight (e.g. 22:00 → 06:00), so the check can't
     * be a bean-validation constraint on the field alone.
     */
    public record ShiftPolicyRequest(
            String name,
            ShiftType shiftType,
            LocalTime startTime,
            LocalTime endTime,
            @Min(0) @Max(120) Integer gracePeriodMinutes,
            @DecimalMin("0.5") @DecimalMax("24.0") Double workingHoursPerDay,
            Boolean overtimeApplicable,
            @DecimalMin("1.0") @DecimalMax("9.99") BigDecimal overtimeMultiplier) {}

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
