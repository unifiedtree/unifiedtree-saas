package com.hrms.attendance.dto;

import com.hrms.core.enums.ApprovalStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record CorrectionRequestResponse(
        UUID id,
        UUID employeeId,
        UUID attendanceRecordId,
        LocalDate requestedDate,
        Instant requestedCheckInAt,
        Instant requestedCheckOutAt,
        String reason,
        String attachmentUrl,
        ApprovalStatus status,
        UUID approverId,
        String approverComment,
        Instant decidedAt,
        Instant createdAt
) {
}
