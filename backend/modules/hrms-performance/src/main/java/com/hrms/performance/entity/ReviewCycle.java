package com.hrms.performance.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.performance.enums.CycleStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "performance_mgmt",
        name = "review_cycles"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ReviewCycle extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "period_start")
    private LocalDate periodStart;

    @Column(name = "period_end")
    private LocalDate periodEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private CycleStatus status = CycleStatus.DRAFT;
}
