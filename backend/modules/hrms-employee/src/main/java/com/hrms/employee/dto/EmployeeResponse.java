package com.hrms.employee.dto;

import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;

import java.time.Instant;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.UUID;

public record EmployeeResponse(
        UUID id,
        UUID tenantId,
        String employeeCode,
        String firstName,
        String lastName,
        String email,
        String phone,
        LocalDate dateOfBirth,
        Gender gender,
        UUID companyId,
        UUID departmentId,
        UUID branchId,
        UUID geoFenceZoneId,
        String weeklyOffDays,
        UUID managerId,
        String jobTitle,
        EmploymentType employmentType,
        EmploymentStatus employmentStatus,
        LocalDate dateOfJoining,
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
        String bankBranchName,
        boolean isFaceEnrolled,
        String profilePhotoUrl,
        boolean hasAccount,
        Instant createdAt
) {}
