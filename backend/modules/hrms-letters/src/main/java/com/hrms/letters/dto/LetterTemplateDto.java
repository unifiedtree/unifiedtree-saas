package com.hrms.letters.dto;

import com.hrms.letters.domain.LetterTemplate;

import java.time.Instant;
import java.util.UUID;

public record LetterTemplateDto(
        UUID id,
        UUID tenantId,
        UUID companyId,
        String name,
        String type,
        String subject,
        String bodyHtml,
        boolean active,
        String variantName,
        Instant createdAt,
        Instant updatedAt,
        String createdBy
) {
    public static LetterTemplateDto from(LetterTemplate t) {
        return new LetterTemplateDto(
                t.getId(), t.getTenantId(), t.getCompanyId(),
                t.getName(), t.getType(), t.getSubject(), t.getBodyHtml(),
                t.isActive(), t.getVariantName(),
                t.getCreatedAt(), t.getUpdatedAt(), t.getCreatedBy()
        );
    }
}
