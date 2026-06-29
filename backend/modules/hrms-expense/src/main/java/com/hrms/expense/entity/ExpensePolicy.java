package com.hrms.expense.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.expense.enums.ExpenseCategory;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "expense_mgmt",
        name = "expense_policies"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ExpensePolicy extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private ExpenseCategory category;

    // NULL = no per-claim cap for this category.
    @Column(name = "max_amount_per_claim")
    private BigDecimal maxAmountPerClaim;

    @Column(name = "requires_receipt")
    private boolean requiresReceipt = true;

    @Column(name = "requires_manager_approval")
    private boolean requiresManagerApproval = true;

    @Column(name = "requires_hr_approval")
    private boolean requiresHrApproval = false;

    @Column(name = "is_active")
    private boolean active = true;
}
