package com.hrms.leave.dto;

import com.hrms.leave.enums.LeaveCategory;

import java.util.UUID;

public record LeaveTypeResponse(
        UUID id,
        String name,
        String code,
        LeaveCategory category,
        double annualEntitlement,
        int maxConsecutiveDays,
        boolean isPaidLeave,
        boolean isCarryForwardAllowed,
        int maxCarryForwardDays,
        boolean isActive,
        /*
         * 2026-09-10: these three were settable via LeaveTypeRequest and stored
         * on the entity, but were absent from this response — so no client could
         * ever read them back.
         *
         * That was not merely cosmetic. updateLeaveType is a FULL REPLACE
         * (LeaveTypeService.updateLeaveType calls setMinNoticeDays /
         * setDescription / setApplicableGender unconditionally), and the web
         * edit drawer built its payload from what it could read. It could read
         * none of these, so opening any leave type on the website and pressing
         * Save silently wiped the minimum-notice rule, the description and the
         * gender restriction — including on types created in the mobile app,
         * which does collect Min Notice Days.
         */
        int minNoticeDays,
        String applicableGender,
        String description
) {
}
