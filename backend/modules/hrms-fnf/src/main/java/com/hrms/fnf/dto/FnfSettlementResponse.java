package com.hrms.fnf.dto;

import com.hrms.fnf.enums.FnfStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record FnfSettlementResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        LocalDate lastWorkingDay,
        FnfStatus status,
        BigDecimal grossPayable,
        BigDecimal totalDeductions,
        BigDecimal netSettlement,
        String notes,
        Instant processedAt,
        Instant approvedAt,
        Instant paidAt,
        UUID approverId,
        Instant createdAt,
        List<FnfComponentResponse> components
) {}
