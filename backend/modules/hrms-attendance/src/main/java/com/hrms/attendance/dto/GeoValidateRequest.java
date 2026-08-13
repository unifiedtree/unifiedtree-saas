package com.hrms.attendance.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Request payload for {@code POST /v1/attendance/geo-fence/check} and the
 * legacy {@code /v1/attendance/geo-validate} pre-flight.
 *
 * <p>Latitude/longitude are required (a missing GPS fix used to 500 in the
 * haversine distance math) and bounded to the physical range so a stuck
 * value like {@code 999.0} produces a 400 instead of a garbage "outside
 * geofence" verdict.
 *
 * <p>QA-FIX (2026-08-13): employeeId is OPTIONAL because the mobile Punch-Out
 * flow does not include it in the request body — the controller derives it
 * from the JWT sub and constructs a fresh {@link GeoValidateRequest}
 * server-side before calling the service. The previous {@code @NotNull}
 * on employeeId caused bean validation to reject with 400 "employeeId:
 * must not be null" BEFORE the controller could run the JWT extraction —
 * this is exactly the error users saw on the mobile Punch-Out screen.
 * Server-side construction always passes a non-null value, so the service
 * layer's contract is unchanged.
 */
public record GeoValidateRequest(
        UUID employeeId,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude
) {}
