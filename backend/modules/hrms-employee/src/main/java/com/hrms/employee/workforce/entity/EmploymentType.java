package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(schema = "org", name = "employment_types")
@Getter
@Setter
public class EmploymentType extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private java.util.UUID companyId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", nullable = false, length = 30)
    private String code;

    @Column(name = "is_payroll_eligible", nullable = false)
    private boolean payrollEligible = true;

    @Column(name = "is_system", nullable = false)
    private boolean system = false;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
