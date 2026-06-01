package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(schema = "org", name = "grades")
@Getter
@Setter
public class Grade extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private java.util.UUID companyId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", length = 30)
    private String code;

    @Column(name = "level", nullable = false)
    private int level = 1;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
