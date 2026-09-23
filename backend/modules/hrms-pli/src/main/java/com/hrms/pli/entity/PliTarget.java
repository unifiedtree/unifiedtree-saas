package com.hrms.pli.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "pli_mgmt", name = "pli_targets")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class PliTarget extends BaseEntity {
    @Column(name = "company_id", nullable = false) private UUID companyId;
    @Column(name = "title", nullable = false, length = 200) private String title;
    @Column(name = "owner_type", nullable = false, length = 40) private String ownerType = "COMPANY";
    @Column(name = "owner_id") private UUID ownerId;
    @Column(name = "period", nullable = false, length = 30) private String period;
    @Column(name = "metric", nullable = false, length = 80) private String metric;
    @Column(name = "target_value", nullable = false) private BigDecimal targetValue = BigDecimal.ZERO;
    @Column(name = "actual_value", nullable = false) private BigDecimal actualValue = BigDecimal.ZERO;
    @Column(name = "weight_percent", nullable = false) private BigDecimal weightPercent = BigDecimal.valueOf(100);
    @Column(name = "payout_amount", nullable = false) private BigDecimal payoutAmount = BigDecimal.ZERO;
    @Column(name = "status", nullable = false, length = 30) private String status = "ACTIVE";
    @Column(name = "notes", columnDefinition = "TEXT") private String notes;
}
