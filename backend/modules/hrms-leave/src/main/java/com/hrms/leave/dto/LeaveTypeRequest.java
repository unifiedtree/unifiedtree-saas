package com.hrms.leave.dto;

import com.hrms.leave.enums.LeaveCategory;
import jakarta.validation.constraints.*;

public record LeaveTypeRequest(
        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @NotBlank(message = "Code is required")
        @Size(max = 30, message = "Code must not exceed 30 characters")
        String code,

        @NotNull(message = "Category is required")
        LeaveCategory category,

        @Positive(message = "Annual entitlement must be positive")
        double annualEntitlement,

        @Min(value = 0, message = "Max consecutive days must be non-negative")
        int maxConsecutiveDays,

        @Min(value = 0, message = "Min notice days must be non-negative")
        int minNoticeDays,

        boolean isCarryForwardAllowed,

        @Min(value = 0, message = "Max carry forward days must be non-negative")
        int maxCarryForwardDays,

        boolean isPaidLeave,

        @Size(max = 20, message = "Applicable gender must not exceed 20 characters")
        String applicableGender,

        String description
) {
}
