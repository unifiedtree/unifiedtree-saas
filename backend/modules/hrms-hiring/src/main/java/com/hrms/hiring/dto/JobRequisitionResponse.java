package com.hrms.hiring.dto;

import com.hrms.hiring.enums.RequisitionStatus;

import java.time.Instant;
import java.util.UUID;

public record JobRequisitionResponse(
        UUID id,
        UUID companyId,
        String title,
        UUID departmentId,
        Integer openings,
        RequisitionStatus status,
        String employmentType,
        String location,
        String description,
        UUID hiringManagerId,
        String hiringManagerName,
        long candidateCount,
        Instant createdAt
) {}
