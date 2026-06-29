package com.hrms.learning.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.learning.enums.EnrollmentStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "learning_mgmt",
        name = "training_enrollments"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class TrainingEnrollment extends BaseEntity {

    // Parent program (→ training_programs.id). Cascades delete with the program at the DB level.
    @Column(name = "program_id", nullable = false)
    private UUID programId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private EnrollmentStatus status = EnrollmentStatus.ENROLLED;

    // Set when the enrollment is marked complete.
    @Column(name = "completed_at")
    private Instant completedAt;

    // Final assessment score (0–100), recorded on completion.
    @Column(name = "score")
    private BigDecimal score;
}
