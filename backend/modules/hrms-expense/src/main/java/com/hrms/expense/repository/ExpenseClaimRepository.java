package com.hrms.expense.repository;

import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.enums.ExpenseStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Query;

import java.util.UUID;
import java.math.BigDecimal;
import java.time.Instant;

@Repository
public interface ExpenseClaimRepository extends JpaRepository<ExpenseClaim, UUID> {

    Page<ExpenseClaim> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    Page<ExpenseClaim> findByApproverIdAndStatusOrderByCreatedAtDesc(UUID approverId, ExpenseStatus status, Pageable pageable);

    Page<ExpenseClaim> findByStatusOrderByCreatedAtDesc(ExpenseStatus status, Pageable pageable);

    /** Tenant-wide open queue (finance/admin): SUBMITTED to approve + APPROVED to reimburse. */
    Page<ExpenseClaim> findByStatusInOrderByCreatedAtDesc(java.util.Collection<ExpenseStatus> statuses, Pageable pageable);

    /** Approver-scoped open queue (managers): only claims routed to this approver. */
    Page<ExpenseClaim> findByApproverIdAndStatusInOrderByCreatedAtDesc(UUID approverId, java.util.Collection<ExpenseStatus> statuses, Pageable pageable);

    long countByStatus(ExpenseStatus status);

    @Query("select coalesce(sum(c.totalAmount), 0) from ExpenseClaim c where c.status = :status")
    BigDecimal sumAmountByStatus(ExpenseStatus status);

    long countByStatusAndReimbursedAtBetween(ExpenseStatus status, Instant from, Instant to);

    @Query("select coalesce(sum(c.totalAmount), 0) from ExpenseClaim c where c.status = :status and c.reimbursedAt >= :from and c.reimbursedAt < :to")
    BigDecimal sumAmountByStatusAndReimbursedAtBetween(ExpenseStatus status, Instant from, Instant to);

    // Approver-scoped versions of the dashboard figures (a manager's own queue).
    long countByApproverIdAndStatus(UUID approverId, ExpenseStatus status);

    @Query("select coalesce(sum(c.totalAmount), 0) from ExpenseClaim c where c.approverId = :approverId and c.status = :status")
    BigDecimal sumAmountByApproverIdAndStatus(UUID approverId, ExpenseStatus status);

    long countByApproverIdAndStatusAndReimbursedAtBetween(UUID approverId, ExpenseStatus status, Instant from, Instant to);

    @Query("select coalesce(sum(c.totalAmount), 0) from ExpenseClaim c where c.approverId = :approverId and c.status = :status and c.reimbursedAt >= :from and c.reimbursedAt < :to")
    BigDecimal sumAmountByApproverIdAndStatusAndReimbursedAtBetween(UUID approverId, ExpenseStatus status, Instant from, Instant to);
}

