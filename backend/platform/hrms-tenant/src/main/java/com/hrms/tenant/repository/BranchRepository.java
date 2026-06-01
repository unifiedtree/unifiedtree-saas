package com.hrms.tenant.repository;

import com.hrms.tenant.entity.Branch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface BranchRepository extends JpaRepository<Branch, UUID> {

    List<Branch> findByCompanyId(UUID companyId);

    List<Branch> findByCompanyIdAndIsActiveTrue(UUID companyId);
}
