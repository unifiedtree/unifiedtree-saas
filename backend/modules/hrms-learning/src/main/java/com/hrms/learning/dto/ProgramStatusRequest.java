package com.hrms.learning.dto;

import com.hrms.learning.enums.ProgramStatus;
import jakarta.validation.constraints.NotNull;

public record ProgramStatusRequest(
        @NotNull ProgramStatus status
) {}
