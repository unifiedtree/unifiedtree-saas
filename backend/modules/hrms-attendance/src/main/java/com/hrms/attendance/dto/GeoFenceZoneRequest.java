package com.hrms.attendance.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Create/update payload for {@code POST/PUT /v1/attendance/geofence/zones}.
 *
 * <p>Field bounds — enforced with bean-validation because the wire values are
 * stored raw into {@code attendance.geo_fence_zones} and later fed into the
 * haversine distance check; garbage in (lat 999, negative radius) silently
 * disables the fence rather than 500-ing at check-time.
 * <ul>
 *   <li>{@code latitude} — [-90, 90]</li>
 *   <li>{@code longitude} — [-180, 180]</li>
 *   <li>{@code radiusMeters} — [1, 10000] (10 km ceiling; the whole point of a
 *       "geofence" evaporates past that).</li>
 * </ul>
 */
public record GeoFenceZoneRequest(
        UUID companyId,
        UUID branchId,
        UUID departmentId,
        @NotBlank String name,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @NotNull @Min(1) @Max(10000) Integer radiusMeters,
        String punchMethod,
        String colorHex,
        String iconKey,
        Boolean active
) {
}
