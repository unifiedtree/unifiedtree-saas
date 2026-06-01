package com.hrms.attendance.dto;

import com.hrms.core.enums.ApprovalStatus;
import jakarta.validation.constraints.NotNull;

public record CorrectionDecisionRequest(
        @NotNull ApprovalStatus status,
        String comment
) {
}
