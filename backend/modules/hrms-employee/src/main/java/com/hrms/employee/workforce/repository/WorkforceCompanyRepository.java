package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Company;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface WorkforceCompanyRepository extends JpaRepository<Company, UUID> {
    /** RLS already isolates to current tenant - no need to filter by tenant_id in the query. */
    List<Company> findAllByActiveTrueOrderByNameAsc();

    /** Active and archived companies, for the Companies &amp; Branches "Inactive" filter. */
    List<Company> findAllByOrderByNameAsc();

    /** Whether the workspace has an active company other than {@code id}. */
    boolean existsByActiveTrueAndIdNot(UUID id);
}
