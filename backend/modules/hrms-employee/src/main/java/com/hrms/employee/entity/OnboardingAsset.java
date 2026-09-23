package com.hrms.employee.entity;

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
@Table(schema = "hrms", name = "onboarding_assets")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class OnboardingAsset extends BaseEntity {
    @Column(name = "company_id", nullable = false) private UUID companyId;
    @Column(name = "employee_id") private UUID employeeId;
    @Column(name = "onboarding_instance_id") private UUID onboardingInstanceId;
    @Column(name = "asset_tag", nullable = false, length = 80) private String assetTag;
    @Column(name = "asset_type", nullable = false, length = 80) private String assetType;
    @Column(name = "asset_name", nullable = false, length = 200) private String assetName;
    @Column(name = "serial_no", length = 120) private String serialNo;
    @Column(name = "status", nullable = false, length = 30) private String status = "AVAILABLE";
    @Column(name = "assigned_at") private LocalDate assignedAt;
    @Column(name = "returned_at") private LocalDate returnedAt;
    @Column(name = "condition_notes", columnDefinition = "TEXT") private String conditionNotes;
}
