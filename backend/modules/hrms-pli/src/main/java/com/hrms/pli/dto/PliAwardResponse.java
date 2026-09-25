package com.hrms.pli.dto;

import com.hrms.pli.enums.PliStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * An incentive award. V143.11 (PLI paid through payroll) added
 * {@code approvedAt}, {@code payrollRunId} (the payroll run that pays it, set
 * when a run including it is processed), {@code payrollPeriod} (that run's
 * month, e.g. "Sep 2026", filled by the API layer) and {@code paidAt}.
 */
public record PliAwardResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        UUID companyId,
        String planName,
        String period,
        BigDecimal amount,
        BigDecimal ratingBasis,
        PliStatus status,
        String notes,
        Instant createdAt,
        Instant approvedAt,
        UUID payrollRunId,
        String payrollPeriod,
        Instant paidAt
) {}
