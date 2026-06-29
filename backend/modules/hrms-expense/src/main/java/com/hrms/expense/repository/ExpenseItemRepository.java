package com.hrms.expense.repository;

import com.hrms.expense.entity.ExpenseItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ExpenseItemRepository extends JpaRepository<ExpenseItem, UUID> {

    List<ExpenseItem> findByClaimIdOrderByExpenseDateAsc(UUID claimId);

    void deleteByClaimId(UUID claimId);
}
