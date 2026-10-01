package com.hrms.letters.dto;

import com.hrms.letters.domain.GeneratedLetter;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;

/**
 * A generated letter. The fields after {@code employeeCode} were added by the
 * redesign (BW-71, BW-74, BW-76) and are additive: older clients ignore them.
 *
 * <ul>
 *   <li>{@code signedAt}: when the employee signed it (the mapped column).</li>
 *   <li>{@code issueDate}: the issue date HR chose ({@code letter.issueDate} in the
 *       generation context); null for letters dated the day they were generated.</li>
 *   <li>{@code departmentName}, {@code templateName}, {@code generatedByName}: read
 *       by the API layer; null when it could not say.</li>
 *   <li>{@code signatureRequested}: HR asked for a signature; null while the
 *       signature table is not there (nothing can be asked then).</li>
 *   <li>{@code signatureRequestedAt}, {@code signedName}: when it was asked, and the
 *       name the employee typed to sign.</li>
 * </ul>
 */
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
        String employeeCode,
        Instant signedAt,
        LocalDate issueDate,
        String departmentName,
        String templateName,
        String generatedByName,
        Boolean signatureRequested,
        Instant signatureRequestedAt,
        String signedName
) {
    /** The generation-context key that holds the issue date (yyyy-MM-dd). */
    public static final String ISSUE_DATE_KEY = "letter.issueDate";

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
                g.getCreatedAt(), g.getUpdatedAt(), employeeName, employeeCode,
                g.getSignedAt(), issueDateOf(g.getGenerationContext()),
                null, null, null, null, null, null
        );
    }

    /** The same letter with the API layer's extra fields. */
    public GeneratedLetterDto withExtras(String departmentName, String templateName, String generatedByName,
                                         Boolean signatureRequested, Instant signatureRequestedAt, String signedName) {
        return new GeneratedLetterDto(id, tenantId, companyId, templateId, employeeId, type, subject, status, hasPdf,
                pdfSizeBytes, sentAt, sentToEmail, viewedAt, voidedAt, voidedReason, generatedBy, generationContext,
                createdAt, updatedAt, employeeName, employeeCode, signedAt, issueDate,
                departmentName, templateName, generatedByName, signatureRequested, signatureRequestedAt, signedName);
    }

    static LocalDate issueDateOf(Map<String, String> ctx) {
        String raw = ctx == null ? null : ctx.get(ISSUE_DATE_KEY);
        if (raw == null || raw.isBlank()) return null;
        try {
            return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
