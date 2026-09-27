package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record StaffStatusResponse(
        UUID employeeId,
        String employeeCode,
        String fullName,
        String jobTitle,
        UUID departmentId,
        String departmentName,
        String profilePhotoUrl,
        String status,
        Instant checkInAt,
        Instant checkOutAt,
        String locationName,
        Double latitude,
        Double longitude,
        // True when the employee has a non-null check_out_at and that checkout,
        // converted to IST wall-clock, is strictly before their assigned shift's
        // end_time. Used by the mobile dashboard's Early Out tile and drill-down.
        // Absent shift assignment / absent end_time / no checkout -> false.
        boolean earlyCheckout,
        // OFFICE / WFH / FIELD — the record's attendance TYPE, which is a
        // different axis from `status`. The dashboard's "Work From Home" tile
        // counts by this field (countSummary), never by status, so a client
        // that only has `status` cannot reproduce that bucket. Null when the
        // employee has no record for the date.
        String attendanceType,
        // True when the employee has APPROVED leave covering this date. The
        // "On Leave" tile counts these, and "Absent" is defined as no punch AND
        // not on leave — neither is reproducible from the punch alone, because
        // leave lives in a different module entirely.
        boolean onLeave,
        // The shift in force on this date (null when unassigned). Together with
        // expectedCheckInAt these answer the client's "one person is late — who,
        // and how late?": status alone said LATE but not against what.
        String shiftName,
        // Scheduled check-in (shift start on the attendance date, IST).
        Instant expectedCheckInAt,
        Integer graceMinutes,
        // Minutes between the scheduled start and the actual check-in, set only
        // when the record's status is LATE (grace already decided lateness).
        Integer lateByMinutes,
        // ── V143.10: the day's effective status (company attendance policy +
        // any reviewer's change). `status` above keeps the mobile app's words.
        // PRESENT / LATE / HALF_DAY / ABSENT / NOT_MARKED / ON_LEAVE / HOLIDAY /
        // WEEKLY_OFF / NOT_TRACKED; null when the policy service is unavailable.
        String effectiveStatus,
        // Plain-English reason for the effective status.
        String statusNote,
        // True when a reviewer set or excused the day by hand.
        boolean statusManual,
        // Late past the allowance and the company counts that as loss of pay.
        boolean lossOfPay,
        // Late, but within the company's late allowance, so it counts as present.
        boolean withinAllowance,
        // Checked in outside the attendance zone (allowed by the company rule).
        boolean outsideGeofence,
        // HR rejected the face punch ("Not them"), so it doesn't count.
        boolean punchRejected,
        // Minutes before the shift end the person left (early leave), else null.
        Integer earlyByMinutes,
        // Minutes between check-in and check-out, else null.
        Integer workedMinutes,
        // ── Roster row facts (V143.53 redesign, BW-13). Additive: every field
        // above keeps its meaning; the mobile app ignores these.
        // The employee's branch, or null when they have none.
        String branchName,
        // How the day's check-in was made (FACE_RECOGNITION, GPS, WEB,
        // MANAGER_OVERRIDE …); null without a check-in.
        String checkInMethod,
        // The APPROVED leave that covers the date (the one `onLeave` counts):
        // its type and first and last day. Null when not on approved leave.
        String leaveTypeName,
        java.time.LocalDate leaveFrom,
        java.time.LocalDate leaveTo,
        // True when a leave request still waiting for approval covers the date.
        // Pending leave never counts as "on leave".
        boolean pendingLeave
) {
    /** The shape before BW-13 (the new roster facts left empty). */
    public StaffStatusResponse(UUID employeeId, String employeeCode, String fullName, String jobTitle, UUID departmentId,
                               String departmentName, String profilePhotoUrl, String status, Instant checkInAt,
                               Instant checkOutAt, String locationName, Double latitude, Double longitude,
                               boolean earlyCheckout, String attendanceType, boolean onLeave, String shiftName,
                               Instant expectedCheckInAt, Integer graceMinutes, Integer lateByMinutes,
                               String effectiveStatus, String statusNote, boolean statusManual, boolean lossOfPay,
                               boolean withinAllowance, boolean outsideGeofence, boolean punchRejected,
                               Integer earlyByMinutes, Integer workedMinutes) {
        this(employeeId, employeeCode, fullName, jobTitle, departmentId, departmentName, profilePhotoUrl, status,
                checkInAt, checkOutAt, locationName, latitude, longitude, earlyCheckout, attendanceType, onLeave,
                shiftName, expectedCheckInAt, graceMinutes, lateByMinutes, effectiveStatus, statusNote, statusManual,
                lossOfPay, withinAllowance, outsideGeofence, punchRejected, earlyByMinutes, workedMinutes,
                null, null, null, null, null, false);
    }

    /** Minutes late for a LATE record against its scheduled start; null otherwise. */
    public static Integer lateBy(String status, Instant checkInAt, Instant expectedCheckInAt) {
        if (!"LATE".equals(status) || checkInAt == null || expectedCheckInAt == null) return null;
        long minutes = java.time.Duration.between(expectedCheckInAt, checkInAt).toMinutes();
        return minutes > 0 ? (int) minutes : null;
    }
}
