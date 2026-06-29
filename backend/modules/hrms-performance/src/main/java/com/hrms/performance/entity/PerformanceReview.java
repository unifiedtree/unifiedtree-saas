package com.hrms.performance.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.performance.enums.ReviewStatus;
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
        schema = "performance_mgmt",
        name = "performance_reviews"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class PerformanceReview extends BaseEntity {

    @Column(name = "cycle_id", nullable = false)
    private UUID cycleId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    // Manager / HR who fills in the review (→ employees.id).
    @Column(name = "reviewer_id")
    private UUID reviewerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ReviewStatus status = ReviewStatus.PENDING;

    // 0.0 .. 5.0, captured at submit time.
    @Column(name = "overall_rating")
    private BigDecimal overallRating;

    @Column(name = "strengths", columnDefinition = "TEXT")
    private String strengths;

    @Column(name = "improvements", columnDefinition = "TEXT")
    private String improvements;

    @Column(name = "submitted_at")
    private Instant submittedAt;
}
