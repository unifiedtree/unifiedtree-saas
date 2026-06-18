package com.hrms.leave.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record LeaveCancelledEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID tenantId,
        UUID approverId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        String cancellationReason,
        Instant occurredAt,
        String employeeName,
        String employeeEmail,
        String approverEmail,
        String approverName
) {
}
