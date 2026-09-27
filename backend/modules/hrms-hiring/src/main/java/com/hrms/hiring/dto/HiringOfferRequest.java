package com.hrms.hiring.dto;

import com.hrms.hiring.enums.OfferStatus;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * @param candidateEmail optional (V143.59). The candidate's email for one-click
 *                       "Send offer email". Left out (null): kept as it is on an
 *                       edit, none on a create. Empty: removed. For an offer
 *                       linked to a candidate it must be the candidate's
 *                       recorded email (the send rule).
 */
public record HiringOfferRequest(
        UUID companyId,
        UUID requisitionId,
        UUID candidateId,
        @NotBlank @Size(max = 200) String candidateName,
        @NotBlank @Size(max = 200) String roleTitle,
        @NotNull @DecimalMin("0.00") BigDecimal offeredCtc,
        LocalDate joiningDate,
        OfferStatus status,
        @Size(max = 10000) String notes,
        @Size(max = 20000) String offerTerms,
        @Email @Size(max = 254) String candidateEmail
) {
    /** The request as it was before the candidate email existed. */
    public HiringOfferRequest(UUID companyId, UUID requisitionId, UUID candidateId, String candidateName,
                              String roleTitle, BigDecimal offeredCtc, LocalDate joiningDate, OfferStatus status,
                              String notes, String offerTerms) {
        this(companyId, requisitionId, candidateId, candidateName, roleTitle, offeredCtc, joiningDate, status,
                notes, offerTerms, null);
    }
}
