package com.hrms.attendance.dto;

import java.util.UUID;

public record GeoFenceZoneResponse(
        UUID id,
        UUID companyId,
        UUID branchId,
        UUID departmentId,
        String name,
        Double latitude,
        Double longitude,
        Integer radiusMeters,
        String punchMethod,
        String colorHex,
        String iconKey,
        boolean active
) {
}
