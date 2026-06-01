package com.hrms.leave.dto;

import com.hrms.core.enums.ApprovalStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record LeaveRequestResponse(
        UUID id,
        UUID employeeId,
        UUID leaveTypeId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        double totalDays,
        String reason,
        ApprovalStatus status,
        String approverComment,
        Instant approvedAt,
        Instant createdAt
) {
}
