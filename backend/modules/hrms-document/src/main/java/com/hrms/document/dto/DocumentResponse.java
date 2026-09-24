package com.hrms.document.dto;

import com.hrms.document.enums.DocumentCategory;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record DocumentResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        String title,
        DocumentCategory category,
        String fileUrl,
        LocalDate issuedDate,
        LocalDate expiryDate,
        String notes,
        Instant createdAt,
        // ── V143.7 typed + verification fields (nullable for legacy rows) ──
        UUID documentTypeId,
        String documentTypeCode,
        String documentTypeName,
        String verificationStatus,
        UUID verifiedBy,
        Instant verifiedAt,
        String rejectionReason,
        String originalFilename,
        Long fileSizeBytes,
        String contentType
) {}
