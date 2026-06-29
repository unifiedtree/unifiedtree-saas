package com.hrms.fnf.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.fnf.enums.FnfComponentType;
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
        schema = "fnf_mgmt",
        name = "fnf_components"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class FnfComponent extends BaseEntity {

    // Parent settlement (→ fnf_settlements.id). Cascades delete with the settlement at the DB level.
    @Column(name = "settlement_id", nullable = false)
    private UUID settlementId;

    @Column(name = "label", nullable = false, length = 200)
    private String label;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 20)
    private FnfComponentType type;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;
}
