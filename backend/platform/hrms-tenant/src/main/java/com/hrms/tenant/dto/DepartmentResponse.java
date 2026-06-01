package com.hrms.tenant.dto;

import java.util.UUID;

public record DepartmentResponse(
        UUID id,
        String name,
        String code,
        UUID companyId,
        UUID parentDepartmentId,
        UUID headEmployeeId,
        boolean isActive,
        String description,
        String colorHex,
        String iconKey
) {
}
