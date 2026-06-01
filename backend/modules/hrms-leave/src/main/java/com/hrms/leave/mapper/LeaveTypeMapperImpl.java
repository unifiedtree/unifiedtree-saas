package com.hrms.leave.mapper;

import com.hrms.leave.dto.LeaveTypeResponse;
import com.hrms.leave.entity.LeaveType;
import com.hrms.leave.enums.LeaveCategory;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:53:09+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class LeaveTypeMapperImpl implements LeaveTypeMapper {

    @Override
    public LeaveTypeResponse toResponse(LeaveType leaveType) {
        if ( leaveType == null ) {
            return null;
        }

        UUID id = null;
        String name = null;
        String code = null;
        LeaveCategory category = null;
        double annualEntitlement = 0.0d;
        int maxConsecutiveDays = 0;
        boolean isPaidLeave = false;
        boolean isCarryForwardAllowed = false;
        int maxCarryForwardDays = 0;
        boolean isActive = false;

        id = leaveType.getId();
        name = leaveType.getName();
        code = leaveType.getCode();
        category = leaveType.getCategory();
        annualEntitlement = leaveType.getAnnualEntitlement();
        maxConsecutiveDays = leaveType.getMaxConsecutiveDays();
        isPaidLeave = leaveType.isPaidLeave();
        isCarryForwardAllowed = leaveType.isCarryForwardAllowed();
        maxCarryForwardDays = leaveType.getMaxCarryForwardDays();
        isActive = leaveType.isActive();

        LeaveTypeResponse leaveTypeResponse = new LeaveTypeResponse( id, name, code, category, annualEntitlement, maxConsecutiveDays, isPaidLeave, isCarryForwardAllowed, maxCarryForwardDays, isActive );

        return leaveTypeResponse;
    }
}
