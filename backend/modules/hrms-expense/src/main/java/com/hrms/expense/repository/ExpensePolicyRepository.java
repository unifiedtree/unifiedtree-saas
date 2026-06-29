package com.hrms.expense.repository;

import com.hrms.expense.entity.ExpensePolicy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ExpensePolicyRepository extends JpaRepository<ExpensePolicy, UUID> {

    List<ExpensePolicy> findByCompanyIdOrderByName(UUID companyId);

    List<ExpensePolicy> findByCompanyIdAndActiveTrueOrderByName(UUID companyId);
}
