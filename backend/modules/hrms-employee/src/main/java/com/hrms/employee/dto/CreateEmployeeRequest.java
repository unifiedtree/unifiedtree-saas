package com.hrms.employee.dto;

import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.UUID;

public record CreateEmployeeRequest(
        @NotBlank String firstName,
        @NotBlank String lastName,
        String middleName,
        @NotBlank @Email String email,
        String personalEmail,
        String phone,
        LocalDate dateOfBirth,
        Gender gender,
        @NotNull UUID companyId,
        UUID departmentId,
        UUID branchId,
        UUID managerId,
        String jobTitle,
        EmploymentType employmentType,
        LocalDate dateOfJoining,
        int noticePeriodDays,
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
        UUID onboardingTemplateId
) {}
