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

    /**
     * Pay band: the annual CTC range this grade pays (V143.22). Both set or
     * both null. Salary Structure warns when a CTC falls outside it; nothing
     * blocks. Pay data, so the API leaves it out for people without
     * hrms.grade.band.read.
     */
    @Column(name = "min_ctc_annual", precision = 14, scale = 2)
    private java.math.BigDecimal minCtcAnnual;

    @Column(name = "max_ctc_annual", precision = 14, scale = 2)
    private java.math.BigDecimal maxCtcAnnual;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
