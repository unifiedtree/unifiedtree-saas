package com.hrms.hiring.dto;

import com.hrms.hiring.enums.CandidateStage;
import jakarta.validation.constraints.NotNull;

public record CandidateStageRequest(
        @NotNull CandidateStage stage
) {}
