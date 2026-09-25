package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Branch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface WorkforceBranchRepository extends JpaRepository<Branch, UUID> {
    List<Branch> findAllByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);
    List<Branch> findAllByActiveTrueOrderByNameAsc();

    /** Every branch of a company, archived ones included (the "Inactive" filter). */
    List<Branch> findAllByCompanyIdOrderByNameAsc(UUID companyId);
    /** Every branch in the tenant, archived ones included. */
    List<Branch> findAllByOrderByNameAsc();

    /** Is another active branch of this company the headquarters? */
    boolean existsByCompanyIdAndHeadquartersTrueAndActiveTrueAndIdNot(UUID companyId, UUID id);

    /**
     * Switches off the headquarters flag on every other branch of the company.
     * Runs as one UPDATE inside the caller's transaction, BEFORE the new
     * headquarters is flagged, so the one-headquarters-per-company index
     * (V143.14) never sees two at once.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE org.branches SET is_headquarters = FALSE, updated_at = now(), version = version + 1 "
            + "WHERE company_id = :companyId AND is_headquarters AND id <> :keepId", nativeQuery = true)
    int clearHeadquartersExcept(@Param("companyId") UUID companyId, @Param("keepId") UUID keepId);

    /** Same as {@link #clearHeadquartersExcept} for a branch that doesn't exist yet (create). */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE org.branches SET is_headquarters = FALSE, updated_at = now(), version = version + 1 "
            + "WHERE company_id = :companyId AND is_headquarters", nativeQuery = true)
    int clearHeadquarters(@Param("companyId") UUID companyId);
}
