package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Company;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface WorkforceCompanyRepository extends JpaRepository<Company, UUID> {
    /** RLS already isolates to current tenant - no need to filter by tenant_id in the query. */
    List<Company> findAllByActiveTrueOrderByNameAsc();

    /** Active and archived companies, for the Companies &amp; Branches "Inactive" filter. */
    List<Company> findAllByOrderByNameAsc();

    /**
     * The workspace's active companies, locked (SELECT ... FOR UPDATE) until the
     * transaction ends. Archiving takes this lock before it checks, so two archives
     * at the same moment can't each see the other company as still active and
     * leave the workspace with none. RLS keeps it to the current tenant.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<Company> findAllByActiveTrue();
}
