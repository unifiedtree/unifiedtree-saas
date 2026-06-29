package com.hrms.policy.dto;

import java.time.Instant;
import java.util.UUID;

public record AcknowledgementResponse(
        UUID id,
        UUID policyId,
        UUID employeeId,
        // Enriched in the API layer (the policy module has no employee dependency).
        String employeeName,
        String employeeCode,
        Instant acknowledgedAt
) {}
