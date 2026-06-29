package com.hrms.expense.repository;

import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.enums.ExpenseStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ExpenseClaimRepository extends JpaRepository<ExpenseClaim, UUID> {

    Page<ExpenseClaim> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    Page<ExpenseClaim> findByApproverIdAndStatusOrderByCreatedAtDesc(UUID approverId, ExpenseStatus status, Pageable pageable);

    Page<ExpenseClaim> findByStatusOrderByCreatedAtDesc(ExpenseStatus status, Pageable pageable);
}
