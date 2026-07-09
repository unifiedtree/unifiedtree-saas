package com.hrms.leave.dto;

import com.hrms.core.enums.ApprovalStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record WfhRequestResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        String departmentName,
        LocalDate fromDate,
        LocalDate toDate,
        String reason,
        ApprovalStatus status,
        UUID approverId,
        String decisionNote,
        Instant decidedAt,
        Instant createdAt
) {
}
