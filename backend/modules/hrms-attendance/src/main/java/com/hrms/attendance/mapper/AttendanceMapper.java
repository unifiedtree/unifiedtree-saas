package com.hrms.attendance.mapper;

import com.hrms.attendance.dto.AttendanceRecordResponse;
import com.hrms.attendance.entity.AttendanceRecord;
import org.mapstruct.Mapper;

@Mapper(componentModel = "spring")
public interface AttendanceMapper {

    AttendanceRecordResponse toResponse(AttendanceRecord record);
}
