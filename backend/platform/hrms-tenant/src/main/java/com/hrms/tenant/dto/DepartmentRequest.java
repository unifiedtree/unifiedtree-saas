package com.hrms.tenant.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record DepartmentRequest(
        @NotBlank String name,
        String code,
        @NotNull UUID companyId,
        UUID parentDepartmentId,
        String description,
        String colorHex,
        String iconKey
) {
}
