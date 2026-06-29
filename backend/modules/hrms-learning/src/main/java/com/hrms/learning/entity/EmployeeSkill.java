package com.hrms.learning.entity;

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
        schema = "learning_mgmt",
        name = "employee_skills"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class EmployeeSkill extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "skill_name", nullable = false, length = 120)
    private String skillName;

    // Self/manager-assessed proficiency on a 1–5 scale.
    @Column(name = "proficiency", nullable = false)
    private Integer proficiency = 1;

    @Column(name = "certified", nullable = false)
    private boolean certified = false;

    @Column(name = "certification_name", length = 200)
    private String certificationName;

    @Column(name = "certified_on")
    private LocalDate certifiedOn;
}
