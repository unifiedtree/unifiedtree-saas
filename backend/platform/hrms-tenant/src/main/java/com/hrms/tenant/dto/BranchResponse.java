package com.hrms.tenant.dto;

import java.util.UUID;

public record BranchResponse(
        UUID id,
        String name,
        String code,
        UUID companyId,
        String address,
        String city,
        String state,
        String country,
        String pincode,
        Double latitude,
        Double longitude,
        int geoFenceRadiusMeters,
        boolean isHeadquarters,
        boolean isActive,
        String colorHex,
        String iconKey
) {
}
