package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "onboarding_templates")
@Getter
@Setter
public class OnboardingTemplate extends BaseEntity {

    // Bean-validation guards on the create/update payload. Without @NotNull on
    // companyId, POST /v1/onboarding/templates with a body missing that field
    // sailed through into JPA and 500'd on the NOT NULL column constraint
    // instead of returning a clean 400 VALIDATION_FAILED.
    @NotNull
    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @NotBlank
    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "designation_id")
    private UUID designationId;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @OneToMany(mappedBy = "templateId", cascade = CascadeType.ALL, orphanRemoval = true,
               fetch = FetchType.LAZY)
    @OrderBy("sequenceNo ASC")
    private List<OnboardingTask> tasks = new ArrayList<>();
}
