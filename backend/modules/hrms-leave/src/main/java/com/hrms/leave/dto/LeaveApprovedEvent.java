package com.hrms.leave.dto;

import com.hrms.core.enums.ApprovalStatus;

import java.time.Instant;
import java.util.UUID;

public record LeaveApprovedEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID tenantId,
        ApprovalStatus status,
        Instant occurredAt
) {
}
