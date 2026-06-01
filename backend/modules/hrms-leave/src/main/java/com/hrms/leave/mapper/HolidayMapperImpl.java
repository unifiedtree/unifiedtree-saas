package com.hrms.leave.mapper;

import com.hrms.leave.dto.HolidayResponse;
import com.hrms.leave.entity.HolidayCalendar;
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
public class HolidayMapperImpl implements HolidayMapper {

    @Override
    public HolidayResponse toResponse(HolidayCalendar holidayCalendar) {
        if ( holidayCalendar == null ) {
            return null;
        }

        UUID id = null;
        String name = null;
        LocalDate holidayDate = null;
        boolean isOptional = false;
        String description = null;

        id = holidayCalendar.getId();
        name = holidayCalendar.getName();
        holidayDate = holidayCalendar.getHolidayDate();
        isOptional = holidayCalendar.isOptional();
        description = holidayCalendar.getDescription();

        HolidayResponse holidayResponse = new HolidayResponse( id, name, holidayDate, isOptional, description );

        return holidayResponse;
    }
}
