package com.hrms.attendance.repository;

import com.hrms.attendance.entity.AttendanceRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttendanceRecordRepository extends JpaRepository<AttendanceRecord, UUID> {

    Optional<AttendanceRecord> findByEmployeeIdAndAttendanceDate(UUID employeeId, LocalDate date);

    Page<AttendanceRecord> findByEmployeeId(UUID employeeId, Pageable pageable);

    List<AttendanceRecord> findByDepartmentIdAndAttendanceDateBetween(UUID deptId, LocalDate from, LocalDate to);

    List<AttendanceRecord> findByEmployeeIdAndAttendanceDateBetween(UUID employeeId, LocalDate from, LocalDate to);

    List<AttendanceRecord> findByEmployeeIdInAndAttendanceDate(List<UUID> employeeIds, LocalDate date);

    List<AttendanceRecord> findByEmployeeIdInAndAttendanceDateBetween(List<UUID> employeeIds, LocalDate from, LocalDate to);

    List<AttendanceRecord> findByCompanyIdAndAttendanceDate(UUID companyId, LocalDate date);

    List<AttendanceRecord> findByCompanyIdAndAttendanceDateBetween(UUID companyId, LocalDate from, LocalDate to);

    Optional<AttendanceRecord> findByClientEventId(String clientEventId);

    @Query("SELECT a FROM AttendanceRecord a WHERE a.companyId = :companyId AND a.attendanceDate = :date")
    List<AttendanceRecord> findByCompanyAndDate(UUID companyId, LocalDate date);

    @Query("SELECT COUNT(a) FROM AttendanceRecord a WHERE a.departmentId = :deptId AND a.attendanceDate = :date AND a.checkInAt IS NOT NULL")
    long countPresentByDepartmentAndDate(UUID deptId, LocalDate date);

    @Query("""
            SELECT a FROM AttendanceRecord a
            WHERE a.employeeId IN :employeeIds
              AND a.attendanceDate = :date
              AND a.checkInAt IS NOT NULL
              AND a.checkOutAt IS NULL
            """)
    List<AttendanceRecord> findActiveSessions(@Param("employeeIds") List<UUID> employeeIds,
                                              @Param("date") LocalDate date);

    List<AttendanceRecord> findByAttendanceDateAndCheckOutAtIsNull(LocalDate attendanceDate);
}
