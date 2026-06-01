package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "designations")
@Getter
@Setter
public class Designation extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 100)
    private String title;

    @Column(name = "grade", length = 10)
    private String grade;          // L1..L6 per client spec

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "reports_to_designation_id")
    private UUID reportsToDesignationId;

    @Column(name = "job_responsibilities", columnDefinition = "TEXT")
    private String jobResponsibilities;

    @Column(name = "headcount_cached")
    private Integer headcountCached;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
