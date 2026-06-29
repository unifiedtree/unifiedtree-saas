package com.hrms.performance.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

public record GoalRequest(
        @NotBlank String title,
        String description,
        Integer weight,
        // Optional — a goal may be tied to a review cycle or stand alone.
        UUID cycleId
) {}
