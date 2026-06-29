package com.hrms.fnf.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record FnfSettlementRequest(
        @NotNull UUID employeeId,
        // Optional — the controller defaults to the employee's company when null.
        UUID companyId,
        @NotNull LocalDate lastWorkingDay,
        String notes,
        @NotEmpty @Valid List<FnfComponentRequest> components
) {}
