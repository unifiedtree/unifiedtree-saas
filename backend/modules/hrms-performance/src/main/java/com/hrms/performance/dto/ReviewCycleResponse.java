package com.hrms.performance.dto;

import com.hrms.performance.enums.CycleStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ReviewCycleResponse(
        UUID id,
        UUID companyId,
        String name,
        LocalDate periodStart,
        LocalDate periodEnd,
        CycleStatus status,
        Instant createdAt
) {}
