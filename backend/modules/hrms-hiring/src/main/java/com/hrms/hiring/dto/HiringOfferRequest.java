package com.hrms.hiring.dto;

import com.hrms.hiring.enums.OfferStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record HiringOfferRequest(
        UUID companyId,
        UUID requisitionId,
        UUID candidateId,
        @NotBlank @Size(max = 200) String candidateName,
        @NotBlank @Size(max = 200) String roleTitle,
        @NotNull @DecimalMin("0.00") BigDecimal offeredCtc,
        LocalDate joiningDate,
        OfferStatus status,
        String notes
) {}
