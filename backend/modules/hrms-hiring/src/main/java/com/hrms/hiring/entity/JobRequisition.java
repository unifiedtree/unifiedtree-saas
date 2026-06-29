package com.hrms.hiring.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.hiring.enums.RequisitionStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "hiring_mgmt",
        name = "job_requisitions"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class JobRequisition extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "openings", nullable = false)
    private Integer openings = 1;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private RequisitionStatus status = RequisitionStatus.OPEN;

    @Column(name = "employment_type", length = 30)
    private String employmentType;

    @Column(name = "location", length = 150)
    private String location;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    // Manager who owns the requisition (→ employees.id). Resolved/enriched at the API layer.
    @Column(name = "hiring_manager_id")
    private UUID hiringManagerId;
}
