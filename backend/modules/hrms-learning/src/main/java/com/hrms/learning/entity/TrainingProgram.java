package com.hrms.learning.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.learning.enums.ProgramStatus;
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
        name = "training_programs"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class TrainingProgram extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "category", length = 50)
    private String category;

    @Column(name = "trainer", length = 150)
    private String trainer;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    // NULL = unlimited seats.
    @Column(name = "capacity")
    private Integer capacity;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ProgramStatus status = ProgramStatus.PLANNED;
}
