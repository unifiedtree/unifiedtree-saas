package com.hrms.compliance.dto;

import com.hrms.compliance.enums.PoshStatus;
import jakarta.validation.constraints.NotNull;

public record PoshStatusRequest(
        @NotNull PoshStatus status,
        String resolution
) {}
