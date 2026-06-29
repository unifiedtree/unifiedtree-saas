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
        Instant createdAt
) {}
