package com.hrms.employee.dto;

import com.hrms.core.enums.EmploymentStatus;

import java.util.UUID;

public record EmployeeSummaryResponse(
        UUID id,
        String employeeCode,
        String firstName,
        String lastName,
        String email,
        String jobTitle,
        UUID departmentId,
        EmploymentStatus employmentStatus
) {}
