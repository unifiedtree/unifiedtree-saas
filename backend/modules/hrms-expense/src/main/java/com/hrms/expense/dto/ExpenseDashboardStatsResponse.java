package com.hrms.expense.dto;

import java.math.BigDecimal;

public record ExpenseDashboardStatsResponse(
        long pendingApprovals,
        BigDecimal pendingApprovalAmount,
        long toBeReimbursed,
        BigDecimal toBeReimbursedAmount,
        long reimbursedThisMonth,
        BigDecimal reimbursedThisMonthAmount
) {}
