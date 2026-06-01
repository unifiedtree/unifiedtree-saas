package com.hrms.leave.dto;

import java.time.LocalDate;
import java.util.UUID;

public record HolidayResponse(
        UUID id,
        String name,
        LocalDate holidayDate,
        boolean isOptional,
        String description
) {
}
