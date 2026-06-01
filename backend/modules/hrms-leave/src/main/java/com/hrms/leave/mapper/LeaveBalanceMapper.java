package com.hrms.leave.mapper;

import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.entity.LeaveBalance;

public interface LeaveBalanceMapper {
    LeaveBalanceResponse toResponse(LeaveBalance leaveBalance);
}

