package com.hrms.leave.mapper;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.entity.LeaveRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:53:09+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class LeaveRequestMapperImpl implements LeaveRequestMapper {

    @Override
    public LeaveRequestResponse toResponse(LeaveRequest leaveRequest) {
        if ( leaveRequest == null ) {
            return null;
        }

        UUID id = null;
        UUID employeeId = null;
        UUID leaveTypeId = null;
        LocalDate startDate = null;
        LocalDate endDate = null;
        double totalDays = 0.0d;
        String reason = null;
        ApprovalStatus status = null;
        String approverComment = null;
        Instant approvedAt = null;
        Instant createdAt = null;

        id = leaveRequest.getId();
        employeeId = leaveRequest.getEmployeeId();
        leaveTypeId = leaveRequest.getLeaveTypeId();
        startDate = leaveRequest.getStartDate();
        endDate = leaveRequest.getEndDate();
        totalDays = leaveRequest.getTotalDays();
        reason = leaveRequest.getReason();
        status = leaveRequest.getStatus();
        approverComment = leaveRequest.getApproverComment();
        approvedAt = leaveRequest.getApprovedAt();
        createdAt = leaveRequest.getCreatedAt();

        String leaveTypeName = null;

        LeaveRequestResponse leaveRequestResponse = new LeaveRequestResponse( id, employeeId, leaveTypeId, leaveTypeName, startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt );

        return leaveRequestResponse;
    }
}
