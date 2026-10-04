package com.hrms.attendance.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A punch-in was saved (punch-in alerts, V143.72). Published by every check-in
 * path inside its transaction: the app's punch and the web punch
 * ({@code AttendanceService.checkInJson}, which an assisted punch also goes
 * through), the legacy face check-in and the canonical JDBC check-in. HR's
 * manual entries and approved corrections are not punches and publish nothing.
 *
 * <p>The alert is sent only after the punch commits, on a background thread
 * ({@code PunchAlertNotifier}), so it can never slow a punch down or undo one.
 *
 * @param method          the stored check-in method (FACE_RECOGNITION, GPS, WEB, …)
 * @param latitude        where the punch was made; null when it wasn't captured
 * @param accuracyMeters  the device's accuracy for that position, when it sent one
 * @param late            the punch was recorded as late
 * @param lateByMinutes   minutes late (null or 0 when on time)
 * @param wfhDay          an approved work-from-home day (the record is filed as WFH)
 * @param offlineCaptured the phone was offline and sent the punch later; checkInAt is when it was made
 * @param receivedAt      when the server received it (differs from checkInAt only for an offline punch)
 */
public record PunchInRecordedEvent(
        UUID tenantId,
        UUID attendanceRecordId,
        UUID employeeId,
        UUID companyId,
        LocalDate attendanceDate,
        Instant checkInAt,
        String method,
        Double latitude,
        Double longitude,
        Double accuracyMeters,
        boolean late,
        Integer lateByMinutes,
        boolean wfhDay,
        boolean offlineCaptured,
        Instant receivedAt
) {}
