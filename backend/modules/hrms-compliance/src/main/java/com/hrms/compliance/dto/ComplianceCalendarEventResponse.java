package com.hrms.compliance.dto;

import java.time.LocalDate;
import java.util.UUID;

public record ComplianceCalendarEventResponse(
        String id,
        UUID companyId,
        String title,
        String type,
        LocalDate date,
        String status,
        String category,
        String ownerName
) {}
