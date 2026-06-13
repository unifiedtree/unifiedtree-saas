package com.hrms.employee.dto;

import com.hrms.employee.enums.EmploymentType;

import java.math.BigDecimal;
import java.util.UUID;

public record UpdateEmployeeRequest(
        String firstName,
        String lastName,
        String phone,
        UUID departmentId,
        UUID branchId,
        UUID geoFenceZoneId,
        UUID managerId,
        String jobTitle,
        EmploymentType employmentType,
        String workLocation,
        String salaryFrequency,
        BigDecimal monthlySalary,
        String panNumber,
        String aadhaarNumber,
        String uanNumber,
        String esiNumber,
        String bankAccountNumber,
        String bankIfscCode,
        String bankName,
        String bankBranchName
) {}
