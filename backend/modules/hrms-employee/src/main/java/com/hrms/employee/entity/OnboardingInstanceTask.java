package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "onboarding_instance_tasks")
@Getter
@Setter
public class OnboardingInstanceTask extends BaseEntity {

    @Column(name = "instance_id", nullable = false)
    private UUID instanceId;

    @Column(name = "task_id", nullable = false)
    private UUID taskId;

    @Column(name = "sequence_no", nullable = false)
    private int sequenceNo = 0;

    @Column(name = "title", length = 200)
    private String title;

    @Column(name = "owner_role", length = 50)
    private String ownerRole;

    @Column(name = "due_on")
    private LocalDate dueDate;

    @Column(name = "status", nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "completed_by")
    private UUID completedBy;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "is_required", nullable = false)
    private boolean required = true;
}
