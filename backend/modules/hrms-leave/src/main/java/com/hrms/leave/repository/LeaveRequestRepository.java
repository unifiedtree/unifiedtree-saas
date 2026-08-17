package com.hrms.leave.repository;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.entity.LeaveRequest;
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
    // B4 FIX (audit 2026-08-15): exclude the manager's own leaves from their
    // approval queue for the same reason as WfhRequestRepository.
    @Query(value = """
        SELECT lr.* FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status = 'PENDING'
          AND lr.employee_id <> :managerEmpId
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        countQuery = """
        SELECT COUNT(*) FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status = 'PENDING'
          AND lr.employee_id <> :managerEmpId
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        nativeQuery = true)
    Page<LeaveRequest> findPendingForManager(@Param("managerEmpId") UUID managerEmpId, Pageable pageable);

    /**
     * Tenant-wide pending queue. Returns EVERY pending leave in the current
     * tenant (RLS enforces the tenant scope automatically). Used when the
     * caller is HR/admin — they need to see requests that route to their
     * reports too, not just their own direct approvals.
     */
    @Query(value = "SELECT lr.* FROM leave_mgmt.leave_requests lr WHERE lr.status = 'PENDING' ORDER BY lr.created_at DESC",
        countQuery = "SELECT COUNT(*) FROM leave_mgmt.leave_requests lr WHERE lr.status = 'PENDING'",
        nativeQuery = true)
    Page<LeaveRequest> findAllPending(Pageable pageable);

    /**
     * Approval-history query for a manager: returns leaves this manager has
     * already DECIDED (APPROVED, REJECTED, CANCELLED — anything except PENDING).
     * Same broadened match as {@link #findPendingForManager} — the manager
     * "owns" a decided leave if they were its approver_id, its applicant's
     * reporting_manager_id, or the applicant's department head — so an
     * assignment change between apply and decision doesn't erase the history.
     * Ordered by updatedAt DESC so the most-recent decision is on top.
     */
    @Query(value = """
        SELECT lr.* FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status <> 'PENDING'
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        ORDER BY lr.updated_at DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM leave_mgmt.leave_requests lr
        LEFT JOIN hrms.employees e   ON e.id = lr.employee_id
        LEFT JOIN hrms.departments d ON d.id = e.department_id
        WHERE lr.status <> 'PENDING'
          AND ( lr.approver_id = :managerEmpId
             OR e.reporting_manager_id = :managerEmpId
             OR d.department_head_employee_id = :managerEmpId )
        """,
        nativeQuery = true)
    Page<LeaveRequest> findDecidedForManager(@Param("managerEmpId") UUID managerEmpId, Pageable pageable);

    /**
     * Overlap detection for the apply-leave path. Returns every leave request
     * for {@code employeeId} that is still "live" (PENDING, PENDING_L2, or
     * APPROVED) and whose date range intersects the proposed range
     * {@code [startDate, endDate]}. Two ranges intersect when
     * {@code existing.startDate <= proposed.endDate} AND
     * {@code existing.endDate   >= proposed.startDate} — the standard overlap
     * predicate. Any non-empty result means the applicant is trying to
     * double-book themselves and must be rejected with LEAVE_DATES_OVERLAP.
     */
    @Query("SELECT lr FROM LeaveRequest lr " +
           "WHERE lr.employeeId = :employeeId " +
           "AND lr.status IN :statuses " +
           "AND lr.startDate <= :endDate " +
           "AND lr.endDate >= :startDate")
    List<LeaveRequest> findOverlapping(@Param("employeeId") UUID employeeId,
                                       @Param("statuses") Collection<ApprovalStatus> statuses,
                                       @Param("startDate") LocalDate startDate,
                                       @Param("endDate") LocalDate endDate);
}
