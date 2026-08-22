package com.hrms.attendance.dto;

import java.time.Instant;

/**
 * Payload for POST /v1/attendance/checkout.
 *
 * <p>The employee identity is ALWAYS derived from the caller's JWT (see
 * {@code AttendanceController.checkOut}); it is never accepted from the
 * request body. Historically this record carried an {@code employeeId}
 * field, which allowed any authenticated user with {@code attendance.checkin.self}
 * to force-checkout an arbitrary employee (IDOR — audit slug
 * {@code checkout-arbitrary-employee-idor}). The field was removed so the
 * controller cannot even accidentally honour a caller-supplied id.
 *
 * <p>If a legitimate manager-force-checkout need arises, add a NEW endpoint
 * (e.g. {@code POST /v1/attendance/team/force-checkout}) guarded by
 * {@code @PreAuthorize("hasAuthority('attendance.regularization.approve')")} —
 * do not reintroduce the field on this DTO.
 *
 * <p><b>capturedAt</b> is the moment the employee actually punched out ON THE
 * DEVICE (stamped at punch/enqueue time by the mobile app). An offline punch
 * can flush hours later — possibly after midnight — which previously stamped
 * the checkout at flush time and looked up the WRONG day's record (404, or a
 * wildly inflated working-hours figure). When present and within bounds the
 * server uses it for the attendance-date lookup, the check-out instant, and
 * the working-hours/overtime math.
 *
 * <p>Like every client-supplied timestamp it is UNTRUSTED: more than 5 minutes
 * in the future, or older than the mobile queue's 24h TTL, and it is discarded
 * in favour of the server clock. Absent => byte-identical to the previous
 * behaviour ({@code Instant.now()}), so older APKs are unaffected.
 */
public record CheckOutRequest(
        Double latitude,
        Double longitude,
        String checkOutMethod,
        String locationName,
        String zoneName,
        String deviceId,
        String clientEventId,
        /**
         * True only when this punch is being replayed from the device's offline
         * queue. {@code capturedAt} is honoured ONLY when this is set — an
         * online punch is happening now, so the server clock wins and a client
         * time on it is ignored (and logged as suspicious). Mirrors the field
         * that already exists on {@code CheckInRequest}.
         */
        boolean offlineCaptured,
        Instant capturedAt
) {}
