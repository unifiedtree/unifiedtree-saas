package com.hrms.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record GeoFenceZoneRequest(
        UUID companyId,
        UUID branchId,
        UUID departmentId,
        @NotBlank String name,
        @NotNull Double latitude,
        @NotNull Double longitude,
        @NotNull Integer radiusMeters,
        String punchMethod,
        String colorHex,
        String iconKey,
        Boolean active
) {
}
