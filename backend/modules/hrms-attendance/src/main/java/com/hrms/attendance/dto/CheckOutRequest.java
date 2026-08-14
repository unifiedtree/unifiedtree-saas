package com.hrms.attendance.dto;

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
 */
public record CheckOutRequest(
        Double latitude,
        Double longitude,
        String checkOutMethod,
        String locationName,
        String zoneName,
        String deviceId,
        String clientEventId
) {}
