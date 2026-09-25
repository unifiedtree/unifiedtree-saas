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

        String description,

        /*
         * V143.23. All three are optional so older clients (the mobile Leave
         * Policies screen, the kit Leave types page) that don't send them
         * keep the stored values on update: null = leave as is.
         *   accrualFrequency  YEARLY (credited upfront) | MONTHLY | QUARTERLY
         *                     ("UPFRONT" is accepted as YEARLY)
         *   isEncashable      employees may ask to cash in unused days
         *   maxEncashDays     yearly limit per person; 0 clears it (no limit)
         */
        @Size(max = 20, message = "Accrual frequency must not exceed 20 characters")
        String accrualFrequency,

        Boolean isEncashable,

        @Min(value = 0, message = "Max encash days must be non-negative")
        @Max(value = 365, message = "Max encash days must be at most 365")
        Integer maxEncashDays
) {
    /** The pre-V143.23 shape, for callers that don't set accrual or encashment. */
    public LeaveTypeRequest(String name, String code, LeaveCategory category, double annualEntitlement,
                            int maxConsecutiveDays, int minNoticeDays, boolean isCarryForwardAllowed,
                            int maxCarryForwardDays, boolean isPaidLeave, String applicableGender,
                            String description) {
        this(name, code, category, annualEntitlement, maxConsecutiveDays, minNoticeDays, isCarryForwardAllowed,
                maxCarryForwardDays, isPaidLeave, applicableGender, description, null, null, null);
    }
}
