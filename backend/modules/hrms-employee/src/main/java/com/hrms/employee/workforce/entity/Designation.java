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

    /**
     * Free-text grade. Since V143.22 it mirrors the code of the linked grade
     * ({@link #gradeId}); a designation whose text matched no grade keeps its
     * text and no id.
     */
    @Column(name = "grade", length = 20)
    private String grade;

    /** The grade this title maps to, by id (V143.22). Null = no grade, or an unmatched legacy text. */
    @Column(name = "grade_id")
    private UUID gradeId;

    /** Short code for the title, unique in the company (V143.22). */
    @Column(name = "code", length = 30)
    private String code;

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
