package com.hrms.attendance.repository;

import com.hrms.attendance.entity.AttendanceEventLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface AttendanceEventLogRepository extends JpaRepository<AttendanceEventLog, UUID> {

    List<AttendanceEventLog> findByEmployeeIdInAndEventDateOrderByEventAtAsc(List<UUID> employeeIds, LocalDate eventDate);

    List<AttendanceEventLog> findByCompanyIdAndEventDateOrderByEventAtAsc(UUID companyId, LocalDate eventDate);
}
