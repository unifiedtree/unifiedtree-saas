package com.hrms.leave.repository;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.entity.LeaveRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface LeaveRequestRepository extends JpaRepository<LeaveRequest, UUID> {

    Page<LeaveRequest> findByEmployeeId(UUID employeeId, Pageable pageable);

    Page<LeaveRequest> findByApproverIdAndStatus(UUID approverId, ApprovalStatus status, Pageable pageable);

    Page<LeaveRequest> findByStatus(ApprovalStatus status, Pageable pageable);

    List<LeaveRequest> findByEmployeeIdAndStatus(UUID employeeId, ApprovalStatus status);
}
