package com.hrms.learning.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public record EmployeeSkillRequest(
        @NotNull UUID employeeId,
        @NotBlank @jakarta.validation.constraints.Size(max = 120) String skillName,
        @Min(1) @Max(5) Integer proficiency,
        Boolean certified,
        @jakarta.validation.constraints.Size(max = 200) String certificationName,
        LocalDate certifiedOn,
        LocalDate expiresOn
) {}
