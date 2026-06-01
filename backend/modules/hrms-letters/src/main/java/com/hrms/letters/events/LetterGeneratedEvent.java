package com.hrms.letters.events;

import java.time.Instant;
import java.util.UUID;

public record LetterGeneratedEvent(
        UUID letterId,
        UUID tenantId,
        UUID employeeId,
        UUID generatedBy,
        String type,
        String action,   // GENERATED | SENT | VOID
        Instant occurredAt
) {}
