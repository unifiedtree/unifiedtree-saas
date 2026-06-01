package com.hrms.employee.dto;

import com.hrms.core.enums.Role;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record StaffOnboardingRequest(
        @Valid @NotNull CreateEmployeeRequest employee,
        List<Role> roles,
        String temporaryPassword,
        boolean biometricEnabled
) {
}
