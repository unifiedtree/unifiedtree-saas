package com.hrms.attendance.dto;

import java.time.LocalDate;
import java.util.List;

public record TeamDashboardResponse(
        LocalDate date,
        AttendanceSummaryCounts counts,
        List<StaffStatusResponse> staffStatuses
) {
}
