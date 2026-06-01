package com.hrms.employee.dto;

import java.util.UUID;

public record EmergencyContactResponse(
        UUID id,
        UUID employeeId,
        String name,
        String relationship,
        String phone,
        String email,
        boolean isPrimary
) {}
