package com.hrms.performance.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

public record GoalRequest(
        @NotBlank String title,
        String description,
        Integer weight,
        // Optional — a goal may be tied to a review cycle or stand alone.
        UUID cycleId,
        // Redesign BW-84/BW-83, optional: when it's due, and the company KPI it counts towards.
        // Written with JDBC after the goal is saved (goals.due_date isn't mapped by the entity).
        java.time.LocalDate dueDate,
        UUID companyKpiId
) {}
