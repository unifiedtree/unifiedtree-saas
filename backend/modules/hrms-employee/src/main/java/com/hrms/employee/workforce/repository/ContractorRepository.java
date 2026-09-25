package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Contractor;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ContractorRepository extends JpaRepository<Contractor, UUID> {
    List<Contractor> findAllByCompanyIdAndActiveTrueOrderByAgencyNameAsc(UUID companyId);
    boolean existsByCompanyIdAndAgencyNameIgnoreCase(UUID companyId, String agencyName);
    /** Active and ended agencies (Master shows both; ended ones can be reactivated). */
    List<Contractor> findAllByCompanyIdOrderByActiveDescAgencyNameAsc(UUID companyId);
    Optional<Contractor> findFirstByCompanyIdAndAgencyNameIgnoreCase(UUID companyId, String agencyName);
}
