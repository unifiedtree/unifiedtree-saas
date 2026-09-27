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
        String employeeName = null;
        String employeeCode = null;
        String departmentName = null;

        // Redesign fields read straight from the row (27 Sep 2026, BW-38). The
        // latest decision is the second-level one when there was one. Names,
        // the type's code, the balance and conflicts are looked up by the API
        // layer (LeaveRequestDetails), so they start out null here.
        Instant l2ApprovedAt = leaveRequest.getL2ApprovedAt();
        Instant decidedAt = l2ApprovedAt != null ? l2ApprovedAt : approvedAt;

        LeaveRequestResponse leaveRequestResponse = new LeaveRequestResponse( id, employeeId, employeeName, employeeCode, departmentName, leaveTypeId, leaveTypeName, startDate, endDate, totalDays, reason, status, approverComment, approvedAt, createdAt,
                null, null, leaveRequest.getDuration(), null, null, null, null, decidedAt, null, l2ApprovedAt, null, null );

        return leaveRequestResponse;
    }
}
