package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.EmploymentType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmploymentTypeRepository extends JpaRepository<EmploymentType, UUID> {

    List<EmploymentType> findByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);

    Optional<EmploymentType> findByCompanyIdAndCode(UUID companyId, String code);

    boolean existsByCompanyIdAndCode(UUID companyId, String code);
}
