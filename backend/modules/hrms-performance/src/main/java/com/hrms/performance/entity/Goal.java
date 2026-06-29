package com.hrms.performance.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.performance.enums.GoalStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "performance_mgmt",
        name = "goals"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Goal extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    // Optional — a goal may be tied to a review cycle or stand alone.
    @Column(name = "cycle_id")
    private UUID cycleId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    // Relative weight of this goal toward the overall score.
    @Column(name = "weight", nullable = false)
    private int weight = 0;

    // Completion percentage, 0 .. 100.
    @Column(name = "progress", nullable = false)
    private int progress = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private GoalStatus status = GoalStatus.ACTIVE;
}
