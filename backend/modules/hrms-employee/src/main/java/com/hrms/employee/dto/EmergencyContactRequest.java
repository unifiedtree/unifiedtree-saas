package com.hrms.employee.dto;

import jakarta.validation.constraints.NotBlank;

public record EmergencyContactRequest(
        @NotBlank String name,
        String relationship,
        String phone,
        String email,
        boolean isPrimary
) {}
