package com.hrms.attendance.dto;

import java.time.Instant;

/**
 * Payload for POST /v1/attendance/checkin.
 *
 * <p><b>capturedAt</b> is the moment the employee actually punched ON THE
 * DEVICE, stamped by the mobile app when the punch is created (online) or
 * enqueued (offline). It exists because an offline punch can sit in the app's
 * queue for hours: an employee who punches in at 09:00 in a no-signal basement
 * and only regains signal at 18:00 was previously recorded at 18:00 — a LATE
 * mark on possibly the WRONG DATE. When present and within bounds, the server
 * uses it for the attendance date, the check-in instant, and the late
 * calculation (see {@code AttendanceService.resolvePunchInstant}).
 *
 * <p>It is UNTRUSTED client input and is validated server-side: a capturedAt
 * more than 5 minutes in the future, or older than the mobile offline queue's
 * 24h TTL, is rejected and the server clock is used instead. Absent (every
 * online punch from an older APK, and the web client) => byte-identical to the
 * previous behaviour, i.e. {@code Instant.now()}.
 *
 * <p>{@code offlineCaptured} is a legacy advisory flag that the server has
 * never acted on; {@code capturedAt} is the field that actually changes
 * behaviour. The flag is retained so existing clients keep deserializing.
 */
public record CheckInRequest(
        double latitude,
        double longitude,
        String faceImageBase64,
        String checkInMethod,
        String locationName,
        String zoneName,
        String deviceId,
        String clientEventId,
        boolean offlineCaptured,
        Instant capturedAt
) {}
