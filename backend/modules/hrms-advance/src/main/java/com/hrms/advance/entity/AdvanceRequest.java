package com.hrms.advance.entity;

import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "advance_mgmt",
        name = "advance_requests"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class AdvanceRequest extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Column(name = "repayment_months", nullable = false)
    private Integer repaymentMonths;

    // Computed server-side as amount / repaymentMonths (never trusted from the client).
    @Column(name = "monthly_deduction", nullable = false)
    private BigDecimal monthlyDeduction;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private AdvanceStatus status = AdvanceStatus.REQUESTED;

    // Manager who approves (→ employees.id). Resolved at request time.
    @Column(name = "approver_id")
    private UUID approverId;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "approver_comment", columnDefinition = "TEXT")
    private String approverComment;

    // Set by Finance once the advance payout is made.
    @Column(name = "disbursed_at")
    private Instant disbursedAt;

    // Remaining balance to be recovered via payroll deductions.
    @Column(name = "outstanding_amount", nullable = false)
    private BigDecimal outstandingAmount = BigDecimal.ZERO;
}
