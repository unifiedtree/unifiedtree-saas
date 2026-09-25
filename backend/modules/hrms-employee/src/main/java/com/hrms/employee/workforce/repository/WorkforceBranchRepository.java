package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Branch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface WorkforceBranchRepository extends JpaRepository<Branch, UUID> {
    List<Branch> findAllByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);
    List<Branch> findAllByActiveTrueOrderByNameAsc();
    /** Active and deactivated branches (the include-archived filter). */
    List<Branch> findAllByCompanyIdOrderByNameAsc(UUID companyId);
    List<Branch> findAllByOrderByNameAsc();
}
