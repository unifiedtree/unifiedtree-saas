package com.hrms.hiring.dto;

import com.hrms.hiring.enums.OfferStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * @param candidateEmail (V143.59) the email one-click "Send offer email" uses:
 *                       the one stored on the offer, else the linked
 *                       candidate's recorded email; null when neither exists.
 */
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
        String emailRecipient,
        String candidateEmail
) {
    /** The response as it was before the candidate email existed (no email). */
    public HiringOfferResponse(UUID id, UUID companyId, UUID requisitionId, UUID candidateId, String candidateName,
                               String roleTitle, BigDecimal offeredCtc, LocalDate joiningDate, OfferStatus status,
                               Instant sentAt, Instant respondedAt, String notes, Instant createdAt, String offerTerms,
                               Instant emailSubmittedAt, String emailRecipient) {
        this(id, companyId, requisitionId, candidateId, candidateName, roleTitle, offeredCtc, joiningDate, status,
                sentAt, respondedAt, notes, createdAt, offerTerms, emailSubmittedAt, emailRecipient, null);
    }
}
