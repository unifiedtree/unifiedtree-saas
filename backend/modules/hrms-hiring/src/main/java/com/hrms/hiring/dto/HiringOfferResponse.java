package com.hrms.hiring.dto;

import com.hrms.hiring.enums.OfferStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record HiringOfferResponse(
        UUID id,
        UUID companyId,
        UUID requisitionId,
        UUID candidateId,
        String candidateName,
        String roleTitle,
        BigDecimal offeredCtc,
        LocalDate joiningDate,
        OfferStatus status,
        Instant sentAt,
        Instant respondedAt,
        String notes,
        Instant createdAt,
        String offerTerms,
        Instant emailSubmittedAt,
        String emailRecipient
) {}
