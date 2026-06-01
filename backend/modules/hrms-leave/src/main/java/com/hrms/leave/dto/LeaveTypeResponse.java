package com.hrms.leave.dto;

import com.hrms.leave.enums.LeaveCategory;

import java.util.UUID;

public record LeaveTypeResponse(
        UUID id,
        String name,
        String code,
        LeaveCategory category,
        double annualEntitlement,
        int maxConsecutiveDays,
        boolean isPaidLeave,
        boolean isCarryForwardAllowed,
        int maxCarryForwardDays,
        boolean isActive
) {
}
