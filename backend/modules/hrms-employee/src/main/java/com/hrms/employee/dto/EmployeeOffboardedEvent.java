package com.hrms.employee.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record EmployeeOffboardedEvent(
        UUID employeeId,
        UUID tenantId,
        UUID companyId,
        String email,
        LocalDate dateOfTermination,
        boolean isResignation,
        Instant occurredAt
) {}
