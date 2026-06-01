package com.hrms.leave.mapper;

import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.entity.LeaveBalance;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:53:08+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class LeaveBalanceMapperImpl implements LeaveBalanceMapper {

    @Override
    public LeaveBalanceResponse toResponse(LeaveBalance leaveBalance) {
        if ( leaveBalance == null ) {
            return null;
        }

        UUID id = null;
        UUID employeeId = null;
        UUID leaveTypeId = null;
        int year = 0;
        double totalEntitlement = 0.0d;
        double used = 0.0d;
        double pending = 0.0d;
        double carryForward = 0.0d;
        double available = 0.0d;

        id = leaveBalance.getId();
        employeeId = leaveBalance.getEmployeeId();
        leaveTypeId = leaveBalance.getLeaveTypeId();
        year = leaveBalance.getYear();
        totalEntitlement = leaveBalance.getTotalEntitlement();
        used = leaveBalance.getUsed();
        pending = leaveBalance.getPending();
        carryForward = leaveBalance.getCarryForward();
        available = leaveBalance.getAvailable();

        String leaveTypeName = null;

        LeaveBalanceResponse leaveBalanceResponse = new LeaveBalanceResponse( id, employeeId, leaveTypeId, leaveTypeName, year, totalEntitlement, used, pending, carryForward, available );

        return leaveBalanceResponse;
    }
}
