package com.hrms.letters.dto;

import com.hrms.letters.domain.DistributionRecipient;

import java.time.Instant;
import java.util.UUID;

public record DistributionRecipientDto(
        UUID id,
        UUID employeeId,
        String email,
        String sendStatus,
        Instant sendAttemptedAt,
        Instant sentAt,
        String errorMessage,
        UUID generatedLetterId
) {
    public static DistributionRecipientDto from(DistributionRecipient r) {
        return new DistributionRecipientDto(
                r.getId(), r.getEmployeeId(), r.getEmail(), r.getSendStatus(),
                r.getSendAttemptedAt(), r.getSentAt(), r.getErrorMessage(), r.getGeneratedLetterId());
    }
}
