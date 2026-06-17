package com.hrms.letters.dto;

import com.hrms.letters.domain.DistributionJob;
import com.hrms.letters.domain.DistributionRecipient;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record DistributionJobDto(
        UUID id,
        UUID templateId,
        String title,
        String customMessage,
        String subjectOverride,
        UUID createdBy,
        Instant createdAt,
        String status,
        int totalRecipients,
        int sentCount,
        int failedCount,
        Instant completedAt,
        List<DistributionRecipientDto> recipients
) {
    /** List/summary view — no recipient rows. */
    public static DistributionJobDto summary(DistributionJob j) {
        return build(j, null);
    }

    /** Detail view — includes recipient rows. */
    public static DistributionJobDto withRecipients(DistributionJob j, List<DistributionRecipient> recipients) {
        return build(j, recipients.stream().map(DistributionRecipientDto::from).toList());
    }

    private static DistributionJobDto build(DistributionJob j, List<DistributionRecipientDto> recipients) {
        return new DistributionJobDto(
                j.getId(), j.getTemplateId(), j.getTitle(), j.getCustomMessage(), j.getSubjectOverride(),
                j.getCreatedBy(), j.getCreatedAt(), j.getStatus(), j.getTotalRecipients(),
                j.getSentCount(), j.getFailedCount(), j.getCompletedAt(), recipients);
    }
}
