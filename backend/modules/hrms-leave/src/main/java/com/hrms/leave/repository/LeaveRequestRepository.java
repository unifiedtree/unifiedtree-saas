package com.hrms.leave.repository;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.entity.LeaveRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface LeaveRequestRepository extends JpaRepository<LeaveRequest, UUID> {

    Page<LeaveRequest> findByEmployeeId(UUID employeeId, Pageable pageable);

    // Kept for legacy / exact-approver code paths (e.g. audits, admin tooling
    // that wants to see rows whose approver_id column literally matches a user).
    // Prefer {@link #findPendingForManager} for the manager approval queue.
    Page<LeaveRequest> findByApproverIdAndStatus(UUID approverId, ApprovalStatus status, Pageable pageable);

    Page<LeaveRequest> findByStatus(ApprovalStatus status, Pageable pageable);

    List<LeaveRequest> findByEmployeeIdAndStatus(UUID employeeId, ApprovalStatus status);

    /**
     * Broadened L1 pending query for the manager approval queue. A manager
     * should see a PENDING leave when ANY of the following holds:
     * <ul>
     *     <li>{@code approver_id} was frozen to this manager at apply time
     *         (the historical behaviour, and still the common case);</li>
     *     <li>the applicant's current {@code reporting_manager_id} points at
     *         this manager (covers the case where the applicant's reporting
     *         relationship was set / changed AFTER the leave was applied, or
     *         where the apply-time fallback resolved to a different UUID);</li>
     *     <li>the applicant's department's {@code department_head_employee_id}
     *         points at this manager (covers dept-head routing).</li>
     * </ul>
     *
     * <p>Tenant isolation is enforced by Postgres RLS on all three tables
     * (leave_mgmt.leave_requests, hrms.employees, hrms.departments) at the
     * {@code ut_app} role — no need to repeat {@code tenant_id} in the WHERE.
     * The LEFT JOINs make the query resilient to orphan rows (a leave whose
     * applicant was deleted, or an applicant with no department).
     */
    @Query(value = """
        SELECT lr.* FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status = 'PENDING'
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        countQuery = """
        SELECT COUNT(*) FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status = 'PENDING'
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        nativeQuery = true)
    Page<LeaveRequest> findPendingForManager(@Param("managerEmpId") UUID managerEmpId, Pageable pageable);
}
