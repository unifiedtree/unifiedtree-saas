package com.hrms.expense.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.expense.enums.ExpenseCategory;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "expense_mgmt",
        name = "expense_items"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ExpenseItem extends BaseEntity {

    // Parent claim (→ expense_claims.id). Cascades delete with the claim at the DB level.
    @Column(name = "claim_id", nullable = false)
    private UUID claimId;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private ExpenseCategory category;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;

    @Column(name = "expense_date", nullable = false)
    private LocalDate expenseDate;

    // Object-storage path for the uploaded receipt; serve via a signed URL.
    @Column(name = "receipt_url", columnDefinition = "TEXT")
    private String receiptUrl;

    @Column(name = "merchant_name", length = 200)
    private String merchantName;
}
