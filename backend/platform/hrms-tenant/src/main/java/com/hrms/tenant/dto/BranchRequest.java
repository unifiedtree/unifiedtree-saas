package com.hrms.tenant.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record BranchRequest(
        @NotBlank String name,
        String code,
        @NotNull UUID companyId,
        String address,
        String city,
        String state,
        String country,
        String pincode,
        Double latitude,
        Double longitude,
        int geoFenceRadiusMeters,
        boolean isHeadquarters,
        String colorHex,
        String iconKey
) {
}
