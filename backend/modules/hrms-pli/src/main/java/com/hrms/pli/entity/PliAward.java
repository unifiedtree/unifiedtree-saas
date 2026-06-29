package com.hrms.pli.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.pli.enums.PliStatus;
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
        schema = "pli_mgmt",
        name = "pli_awards"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class PliAward extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "plan_name", nullable = false, length = 200)
    private String planName;

    // Incentive period the award relates to (e.g. "FY24-Q3", "2025-H1").
    @Column(name = "period", length = 20)
    private String period;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount = BigDecimal.ZERO;

    // Performance rating that justifies the award (e.g. 4.5 on a 5-point scale).
    @Column(name = "rating_basis")
    private BigDecimal ratingBasis;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private PliStatus status = PliStatus.PROPOSED;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;
}
