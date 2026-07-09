package com.hrms.leave.repository;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.entity.WfhRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface WfhRequestRepository extends JpaRepository<WfhRequest, UUID> {

    Page<WfhRequest> findByEmployeeIdOrderByFromDateDesc(UUID employeeId, Pageable pageable);

    Page<WfhRequest> findByApproverIdAndStatus(UUID approverId, ApprovalStatus status, Pageable pageable);

    /**
     * Broadened WFH manager queue: mirrors the LeaveRequestRepository pattern —
     * a manager sees a PENDING WFH when it was frozen to their id at apply
     * time, when the applicant's current reporting_manager_id points at them,
     * or when they are the applicant's department head. Tenant isolation is
     * enforced by RLS on all three tables.
     */
    @Query(value = """
        SELECT wr.* FROM leave_mgmt.wfh_requests wr
        LEFT JOIN hrms.employees   e ON e.id = wr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE wr.status = 'PENDING'
          AND ( wr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        countQuery = """
        SELECT COUNT(*) FROM leave_mgmt.wfh_requests wr
        LEFT JOIN hrms.employees   e ON e.id = wr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE wr.status = 'PENDING'
          AND ( wr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        nativeQuery = true)
    Page<WfhRequest> findPendingForManager(@Param("managerEmpId") UUID managerEmpId, Pageable pageable);

    /**
     * Any existing WFH request for the same employee that overlaps
     * [{@code fromDate}, {@code toDate}] and is currently in one of the
     * given statuses. Used at apply time to block a duplicate submission on
     * top of an already PENDING or APPROVED range.
     *
     * <p>Standard interval-overlap predicate: two intervals [a,b] and [c,d]
     * overlap iff {@code a <= d AND c <= b}. Spring Data derived queries
     * cannot express that directly, so we pass toDate to the "start <= X"
     * side and fromDate to the "end >= Y" side.
     */
    List<WfhRequest> findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
            UUID employeeId, Collection<ApprovalStatus> statuses, LocalDate to, LocalDate from);
}
