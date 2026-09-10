package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Department in the canonical hrms schema. Departments belong to a company
 * and may be nested (parent_department_id). RLS handles tenant isolation.
 */
@Entity
@Table(schema = "hrms", name = "departments")
@Getter
@Setter
public class Department extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", length = 30)
    private String code;

    @Column(name = "parent_department_id")
    private UUID parentDepartmentId;

    @Column(name = "department_head_employee_id")
    private UUID departmentHeadEmployeeId;

    /**
     * 2026-09-10: added so the colour + icon an admin picks in the Add
     * Department drawer are a real org setting, not a per-browser
     * localStorage key. Both nullable so pre-existing rows keep the SPA's
     * default until edited.
     */
    @Column(name = "color_hex", length = 9)
    private String colorHex;

    @Column(name = "icon_key", length = 40)
    private String iconKey;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "employee_count_cached")
    private Integer employeeCountCached;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
