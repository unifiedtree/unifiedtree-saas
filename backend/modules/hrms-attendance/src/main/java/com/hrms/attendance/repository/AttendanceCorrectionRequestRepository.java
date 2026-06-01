package com.hrms.attendance.repository;

import com.hrms.attendance.entity.AttendanceCorrectionRequest;
import com.hrms.core.enums.ApprovalStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AttendanceCorrectionRequestRepository extends JpaRepository<AttendanceCorrectionRequest, UUID> {

    Page<AttendanceCorrectionRequest> findByEmployeeId(UUID employeeId, Pageable pageable);

    Page<AttendanceCorrectionRequest> findByEmployeeIdIn(List<UUID> employeeIds, Pageable pageable);

    Page<AttendanceCorrectionRequest> findByEmployeeIdInAndStatus(List<UUID> employeeIds, ApprovalStatus status, Pageable pageable);
}
