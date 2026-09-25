package com.hrms.expense.repository;

import com.hrms.expense.entity.ExpenseItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ExpenseItemRepository extends JpaRepository<ExpenseItem, UUID> {

    List<ExpenseItem> findByClaimIdOrderByExpenseDateAsc(UUID claimId);

    /** Per claim: [claimId, line count, lines with a receipt (blank counts as none, like hasReceipt)]. One query for a whole page of claims. */
    @org.springframework.data.jpa.repository.Query(
            "select i.claimId, count(i), count(nullif(trim(i.receiptUrl), '')) from ExpenseItem i where i.claimId in :claimIds group by i.claimId")
    List<Object[]> countItemsAndReceipts(@org.springframework.data.repository.query.Param("claimIds") java.util.Collection<UUID> claimIds);

    void deleteByClaimId(UUID claimId);
}
