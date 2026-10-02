package com.hrms.performance.dto;

import com.hrms.performance.enums.GoalStatus;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.UUID;

public record GoalResponse(
        UUID id,
        UUID employeeId,
        UUID cycleId,
        String title,
        String description,
        int weight,
        int progress,
        GoalStatus status,
        Instant createdAt,
        BigDecimal targetValue,
        BigDecimal currentValue,
        String unit,
        // Redesign BW-84/BW-83 (added fields only; filled by the API layer for /goals/my):
        // the due date, the last progress update (its note, when, and the value before it),
        // and the company KPI the goal counts towards.
        java.time.LocalDate dueDate,
        String lastNote,
        Instant lastUpdatedAt,
        BigDecimal previousValue,
        UUID companyKpiId,
        String companyKpiTitle
) {
    /** Today's fields only (the extras are null). */
    public GoalResponse(UUID id, UUID employeeId, UUID cycleId, String title, String description, int weight,
                        int progress, GoalStatus status, Instant createdAt, BigDecimal targetValue,
                        BigDecimal currentValue, String unit) {
        this(id, employeeId, cycleId, title, description, weight, progress, status, createdAt, targetValue,
                currentValue, unit, null, null, null, null, null, null);
    }

    /** This goal with the API layer's extras. */
    public GoalResponse with(java.time.LocalDate due, String note, Instant updatedAt, BigDecimal previous,
                             UUID kpiId, String kpiTitle) {
        return new GoalResponse(id, employeeId, cycleId, title, description, weight, progress, status, createdAt,
                targetValue, currentValue, unit, due, note, updatedAt, previous, kpiId, kpiTitle);
    }
}
