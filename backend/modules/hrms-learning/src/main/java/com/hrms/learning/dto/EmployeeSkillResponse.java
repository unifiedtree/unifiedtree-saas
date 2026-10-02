package com.hrms.learning.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record EmployeeSkillResponse(
        UUID id,
        UUID employeeId,
        String skillName,
        Integer proficiency,
        boolean certified,
        String certificationName,
        LocalDate certifiedOn,
        Instant createdAt,
        LocalDate expiresOn,
        // Redesign BW-85 (added): when the record last changed.
        Instant updatedAt
) {}
