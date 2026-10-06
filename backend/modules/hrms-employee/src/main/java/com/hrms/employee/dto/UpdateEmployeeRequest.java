package com.hrms.employee.dto;

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
        String employmentType,      // a default code or the company's own type's code (6 Oct 2026)
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
