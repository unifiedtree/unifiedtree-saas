package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "onboarding_tasks")
@Getter
@Setter
public class OnboardingTask extends BaseEntity {

    @Column(name = "template_id", nullable = false)
    private UUID templateId;

    @Column(name = "sequence_no", nullable = false)
    private int sequenceNo = 0;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "owner_role", length = 50)
    private String ownerRole;

    @Column(name = "due_offset_days", nullable = false)
    private int dueOffsetDays = 1;

    @Column(name = "is_required", nullable = false)
    private boolean required = true;
}
