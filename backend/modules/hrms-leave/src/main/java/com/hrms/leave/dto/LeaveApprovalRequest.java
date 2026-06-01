package com.hrms.leave.dto;

import com.hrms.core.enums.ApprovalStatus;
import jakarta.validation.constraints.NotNull;

public record LeaveApprovalRequest(
        @NotNull(message = "Status is required")
        ApprovalStatus status,

        String comment
) {
}
