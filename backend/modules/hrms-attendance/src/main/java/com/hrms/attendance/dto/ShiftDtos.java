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
            BigDecimal overtimeMultiplier,
            /** V143.23: short code, e.g. "GEN" (null when not set). */
            String code,
            /** V143.23: core hours of a FLEXIBLE shift (null when not set). */
            LocalTime coreStartTime,
            LocalTime coreEndTime,
            /** V143.23: weekly offs for people on this shift, ISO 1 = Mon … 7 = Sun (null when not set). */
            java.util.List<Integer> weeklyOffDays) {}

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
            @DecimalMin("1.0") @DecimalMax("9.99") BigDecimal overtimeMultiplier,
            /*
             * V143.23, all optional; null leaves the stored value as it is (the
             * update is a merge), so older clients can't wipe them.
             *   code            1–20 letters, digits, - or _ ("" clears it)
             *   coreStartTime / coreEndTime   FLEXIBLE only; both or neither
             *   weeklyOffDays   ISO days 1–7; [] clears them
             */
            String code,
            LocalTime coreStartTime,
            LocalTime coreEndTime,
            java.util.List<Integer> weeklyOffDays) {

        /** The pre-V143.23 shape. */
        public ShiftPolicyRequest(String name, ShiftType shiftType, LocalTime startTime, LocalTime endTime,
                                  Integer gracePeriodMinutes, Double workingHoursPerDay, Boolean overtimeApplicable,
                                  BigDecimal overtimeMultiplier) {
            this(name, shiftType, startTime, endTime, gracePeriodMinutes, workingHoursPerDay, overtimeApplicable,
                    overtimeMultiplier, null, null, null, null);
        }
    }

    /**
     * Assign a shift to an employee. effectiveFrom defaults to today when null.
     * {@code note} (optional, up to 500 characters) is why — "Swapped with
     * Vikram for the quarter" — kept with the assignment and shown in the
     * employee's shift history (V143.25).
     */
    public record AssignShiftRequest(
            UUID shiftPolicyId,
            LocalDate effectiveFrom,
            String note) {
        public AssignShiftRequest(UUID shiftPolicyId, LocalDate effectiveFrom) {
            this(shiftPolicyId, effectiveFrom, null);
        }
    }

    /**
     * One assignment in an employee's shift history, newest first
     * (GET /v1/shifts/employee/{id}/history). {@code effectiveTo} is null for
     * the open-ended one. {@code setBy} / {@code setAt} are who made the
     * assignment and when; {@code note} is why.
     */
    public record ShiftAssignmentHistoryItem(
            UUID id,
            UUID shiftPolicyId,
            String shiftName,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate effectiveFrom,
            LocalDate effectiveTo,
            String note,
            String setBy,
            Instant setAt) {}

    /**
     * The employee's shift in force today plus any scheduled change. Policy
     * fields are null when nothing is in force today; the {@code upcoming*}
     * fields are null when no future-dated assignment exists. From
     * {@code assignShift} the policy fields describe the assignment just made
     * (which may itself start in the future).
     */
    public record EmployeeShiftResponse(
            UUID employeeId,
            UUID shiftPolicyId,
            String shiftName,
            ShiftType shiftType,
            LocalTime startTime,
            LocalTime endTime,
            int gracePeriodMinutes,
            LocalDate effectiveFrom,
            LocalDate effectiveTo,
            UUID upcomingShiftPolicyId,
            String upcomingShiftName,
            LocalDate upcomingEffectiveFrom) {}

    // ── Shift-change requests (employee → HR approve) ────────────────────────

    /**
     * Employee submits a request to move to {@code requestedShiftPolicyId} from
     * {@code effectiveDate} (today or later), with a reason of 10–500
     * characters. {@code effectiveDate} is optional only because app builds
     * from before the date field omit it; such a request starts on the day it
     * is approved.
     */
    public record CreateShiftChangeRequest(
            UUID requestedShiftPolicyId,
            String reason,
            LocalDate effectiveDate) {}

    /**
     * HR/manager decides a request. An approved request starts on the
     * employee's date; a request still pending after that date has expired
     * and cannot be approved.
     */
    public record ShiftChangeDecisionRequest(
            boolean approved,
            String comment) {}

    /**
     * A shift-change request row. {@code employeeName} and {@code employeeCode}
     * come from the employee record: resolving them client-side used to print a
     * bare "Employee" whenever the requester was missing from the caller's
     * team-today list (for instance on their weekly off).
     * {@code requestedEffectiveDate} is what the employee asked for (null on old
     * requests); {@code appliedEffectiveDate} is when the new shift actually
     * starts (set on approval). {@code approverName} is who decided it (null
     * while pending, and for requests that expired on their own).
     */
    public record ShiftChangeRequestResponse(
            UUID id,
            UUID employeeId,
            String employeeName,
            String employeeCode,
            UUID currentShiftPolicyId,
            String currentShiftName,
            UUID requestedShiftPolicyId,
            String requestedShiftName,
            String reason,
            String status,
            UUID approverId,
            String decisionNote,
            Instant decidedAt,
            Instant createdAt,
            LocalDate requestedEffectiveDate,
            LocalDate appliedEffectiveDate,
            String approverName) {}
}
