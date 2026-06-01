package com.hrms.leave.mapper;

import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.entity.LeaveRequest;

public interface LeaveRequestMapper {
    LeaveRequestResponse toResponse(LeaveRequest leaveRequest);
}

