package com.hrms.leave.dto;

import java.util.UUID;

public record LeaveBalanceResponse(
        UUID id,
        UUID employeeId,
        UUID leaveTypeId,
        String leaveTypeName,
        int year,
        double totalEntitlement,
        double used,
        double pending,
        double carryForward,
        double available
) {
}
