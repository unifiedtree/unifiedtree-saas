package com.hrms.leave.mapper;

import com.hrms.leave.dto.LeaveTypeResponse;
import com.hrms.leave.entity.LeaveType;

public interface LeaveTypeMapper {
    LeaveTypeResponse toResponse(LeaveType leaveType);
}

