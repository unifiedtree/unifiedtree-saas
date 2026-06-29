package com.hrms.policy.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.policy.enums.PolicyStatus;
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
        schema = "policy_mgmt",
        name = "hr_policies"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class HrPolicy extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "category", length = 50)
    private String category;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    // The published document version (e.g. "v1.2") — distinct from the
    // BaseEntity optimistic-lock {@code version} column.
    @Column(name = "policy_version", length = 20)
    private String policyVersion;

    @Column(name = "effective_date")
    private LocalDate effectiveDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private PolicyStatus status = PolicyStatus.ACTIVE;
}
