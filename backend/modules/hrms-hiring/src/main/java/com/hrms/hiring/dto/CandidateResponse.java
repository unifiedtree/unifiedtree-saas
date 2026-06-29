package com.hrms.hiring.dto;

import com.hrms.hiring.enums.CandidateStage;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record CandidateResponse(
        UUID id,
        UUID requisitionId,
        String fullName,
        String email,
        String phone,
        CandidateStage stage,
        String source,
        BigDecimal expectedCtc,
        String notes,
        Instant createdAt
) {}
