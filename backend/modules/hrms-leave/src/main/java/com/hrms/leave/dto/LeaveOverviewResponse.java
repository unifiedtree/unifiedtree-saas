package com.hrms.leave.dto;

import java.util.List;

public record LeaveOverviewResponse(
        List<LeaveBalanceResponse> balances,
        List<LeaveRequestResponse> recentRequests,
        long pendingApprovals
) {
}
