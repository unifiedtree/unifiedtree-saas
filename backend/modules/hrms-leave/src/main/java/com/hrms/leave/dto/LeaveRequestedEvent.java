package com.hrms.leave.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record LeaveRequestedEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID tenantId,
        UUID approverId,
        LocalDate startDate,
        LocalDate endDate,
        double totalDays,
        String leaveTypeName,
        Instant occurredAt
) {
}
