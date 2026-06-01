package com.hrms.leave.mapper;

import com.hrms.leave.dto.HolidayResponse;
import com.hrms.leave.entity.HolidayCalendar;

public interface HolidayMapper {
    HolidayResponse toResponse(HolidayCalendar holidayCalendar);
}

