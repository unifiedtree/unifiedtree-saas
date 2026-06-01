package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Contractor;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ContractorRepository extends JpaRepository<Contractor, UUID> {
    List<Contractor> findAllByCompanyIdAndActiveTrueOrderByAgencyNameAsc(UUID companyId);
    boolean existsByCompanyIdAndAgencyNameIgnoreCase(UUID companyId, String agencyName);
}
