package com.hrms.compliance.entity;

import com.hrms.compliance.enums.ComplianceStatus;
import com.hrms.core.entity.BaseEntity;
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
        schema = "compliance_mgmt",
        name = "compliance_items"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ComplianceItem extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "category", length = 50)
    private String category;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ComplianceStatus status = ComplianceStatus.PENDING;

    // How often this obligation recurs (e.g. MONTHLY, QUARTERLY, ANNUAL). Free text.
    @Column(name = "frequency", length = 30)
    private String frequency;

    // Employee accountable for the obligation (→ employees.id).
    @Column(name = "owner_id")
    private UUID ownerId;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;
}
