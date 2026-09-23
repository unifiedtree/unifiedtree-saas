package com.hrms.letters.dto;

import com.hrms.letters.domain.GeneratedLetter;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record GeneratedLetterDto(
        UUID id,
        UUID tenantId,
        UUID companyId,
        UUID templateId,
        UUID employeeId,
        String type,
        String subject,
        String status,
        boolean hasPdf,
        Long pdfSizeBytes,
        Instant sentAt,
        String sentToEmail,
        Instant viewedAt,
        Instant voidedAt,
        String voidedReason,
        UUID generatedBy,
        Map<String, String> generationContext,
        Instant createdAt,
        Instant updatedAt,
        String employeeName,
        String employeeCode
) {
    public static GeneratedLetterDto from(GeneratedLetter g) {
        return from(g, null, null);
    }

    public static GeneratedLetterDto from(GeneratedLetter g, String employeeName, String employeeCode) {
        return new GeneratedLetterDto(
                g.getId(), g.getTenantId(), g.getCompanyId(),
                g.getTemplateId(), g.getEmployeeId(),
                g.getType(), g.getSubject(), g.getStatus(),
                g.getPdfPath() != null,
                g.getPdfSizeBytes(),
                g.getSentAt(), g.getSentToEmail(),
                g.getViewedAt(),
                g.getVoidedAt(), g.getVoidedReason(),
                g.getGeneratedBy(),
                g.getGenerationContext(),
                g.getCreatedAt(), g.getUpdatedAt(), employeeName, employeeCode
        );
    }
}
