package com.hrms.compliance.entity;

import com.hrms.compliance.enums.PoshStatus;
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
        name = "posh_complaints"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class PoshComplaint extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    // Register reference; generated server-side when not supplied.
    @Column(name = "complaint_no", nullable = false, length = 60)
    private String complaintNo;

    @Column(name = "filed_date", nullable = false)
    private LocalDate filedDate;

    @Column(name = "severity", length = 20)
    private String severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private PoshStatus status = PoshStatus.RECEIVED;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "resolution", columnDefinition = "TEXT")
    private String resolution;

    // Set when the complaint reaches a RESOLVED outcome.
    @Column(name = "resolved_date")
    private LocalDate resolvedDate;
}
