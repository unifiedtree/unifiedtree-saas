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
 */
public record GeoValidateRequest(
        @NotNull UUID employeeId,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude
) {}
