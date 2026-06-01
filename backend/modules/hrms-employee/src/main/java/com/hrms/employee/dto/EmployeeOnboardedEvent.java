package com.hrms.employee.dto;

import java.time.Instant;
import java.util.UUID;

public record EmployeeOnboardedEvent(
        UUID employeeId,
        UUID tenantId,
        UUID companyId,
        UUID departmentId,
        String email,
        Instant occurredAt
) {}
