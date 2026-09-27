package com.hrms.fnf.dto;

import com.hrms.fnf.enums.FnfStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A full &amp; final settlement. The leaver's name, code, department and
 * employment status are filled in by the API layer (the fnf module has no
 * dependency on the employee module); {@code departmentId},
 * {@code departmentName} and {@code employmentStatus} were added for the
 * redesign (BW-64) and are null where the record can't be read.
 */
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
        List<FnfComponentResponse> components,
        UUID departmentId,
        String departmentName,
        /** The leaver's employment status today (EXITED, TERMINATED, …). */
        String employmentStatus
) {
    /** Without the employee-record fields (the service layer's view). */
    public FnfSettlementResponse(UUID id, UUID employeeId, String employeeName, String employeeCode, UUID companyId,
                                 LocalDate lastWorkingDay, FnfStatus status, BigDecimal grossPayable,
                                 BigDecimal totalDeductions, BigDecimal netSettlement, String notes,
                                 Instant processedAt, Instant approvedAt, Instant paidAt, UUID approverId,
                                 Instant createdAt, List<FnfComponentResponse> components) {
        this(id, employeeId, employeeName, employeeCode, companyId, lastWorkingDay, status, grossPayable,
                totalDeductions, netSettlement, notes, processedAt, approvedAt, paidAt, approverId, createdAt,
                components, null, null, null);
    }
}
