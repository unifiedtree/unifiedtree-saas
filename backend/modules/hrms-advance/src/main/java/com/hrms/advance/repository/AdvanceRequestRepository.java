package com.hrms.advance.repository;

import com.hrms.advance.entity.AdvanceRequest;
import com.hrms.advance.enums.AdvanceStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface AdvanceRequestRepository extends JpaRepository<AdvanceRequest, UUID> {

    Page<AdvanceRequest> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    Page<AdvanceRequest> findByStatusOrderByCreatedAtDesc(AdvanceStatus status, Pageable pageable);

    /** Approvals queue needs REQUESTED (to approve) + APPROVED (to disburse) in one list. */
    Page<AdvanceRequest> findByStatusInOrderByCreatedAtDesc(java.util.Collection<AdvanceStatus> statuses, Pageable pageable);

    /**
     * Same queue, restricted to the advances routed to ONE approver.
     *
     * <p>2026-09-09: the approvals list was tenant-wide for anyone holding
     * hrms.advance.approve — a permission DEPT_MANAGER holds — so a department
     * manager could see, and approve, every salary advance in the company
     * including other departments' and executives'. approver_id is written at
     * request time (requestAdvance sets it from the reporting manager), so
     * scoping by it is possible without any schema change.
     */
    Page<AdvanceRequest> findByStatusInAndApproverIdOrderByCreatedAtDesc(
            java.util.Collection<AdvanceStatus> statuses, UUID approverId, Pageable pageable);
}
