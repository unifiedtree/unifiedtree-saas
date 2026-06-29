package com.hrms.expense.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.expense.enums.ExpenseStatus;
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
        schema = "expense_mgmt",
        name = "expense_claims"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ExpenseClaim extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 300)
    private String title;

    // Maintained by the app as the sum of all line items.
    @Column(name = "total_amount", nullable = false)
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(name = "currency", length = 10)
    private String currency = "INR";

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ExpenseStatus status = ExpenseStatus.DRAFT;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    // Manager who approves (→ employees.id). Resolved at submit time.
    @Column(name = "approver_id")
    private UUID approverId;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "approver_comment", columnDefinition = "TEXT")
    private String approverComment;

    // Set by Finance after the reimbursement payment is made.
    @Column(name = "reimbursed_at")
    private Instant reimbursedAt;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;
}
