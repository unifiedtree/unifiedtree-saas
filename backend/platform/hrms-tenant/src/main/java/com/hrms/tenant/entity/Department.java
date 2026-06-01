package com.hrms.tenant.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "departments")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Department extends BaseEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "code")
    private String code;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "parent_department_id")
    private UUID parentDepartmentId;

    @Column(name = "head_employee_id")
    private UUID headEmployeeId;

    @Column(name = "is_active", columnDefinition = "BOOLEAN DEFAULT true")
    private boolean isActive = true;

    @Column(name = "description")
    private String description;

    @Column(name = "color_hex", length = 20)
    private String colorHex;

    @Column(name = "icon_key", length = 50)
    private String iconKey;
}
