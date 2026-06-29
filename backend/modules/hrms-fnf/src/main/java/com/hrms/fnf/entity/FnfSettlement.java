package com.hrms.fnf.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.fnf.enums.FnfStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "fnf_mgmt",
        name = "fnf_settlements"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class FnfSettlement extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "last_working_day", nullable = false)
    private LocalDate lastWorkingDay;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private FnfStatus status = FnfStatus.INITIATED;

    // Maintained by the app as the sum of EARNING components.
    @Column(name = "gross_payable", nullable = false)
    private BigDecimal grossPayable = BigDecimal.ZERO;

    // Maintained by the app as the sum of DEDUCTION components.
    @Column(name = "total_deductions", nullable = false)
    private BigDecimal totalDeductions = BigDecimal.ZERO;

    // gross_payable − total_deductions, computed server-side.
    @Column(name = "net_settlement", nullable = false)
    private BigDecimal netSettlement = BigDecimal.ZERO;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "processed_at")
    private Instant processedAt;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    // Approver who signs off the settlement (→ employees.id). Resolved at approval time.
    @Column(name = "approver_id")
    private UUID approverId;
}
