package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.WorkforceEmployee;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkforceEmployeeRepository
        extends JpaRepository<WorkforceEmployee, UUID>,
                JpaSpecificationExecutor<WorkforceEmployee> {

    Optional<WorkforceEmployee> findByCompanyIdAndEmployeeCode(UUID companyId, String employeeCode);
    boolean existsByCompanyIdAndEmployeeCode(UUID companyId, String employeeCode);
    boolean existsByCompanyIdAndEmailIgnoreCase(UUID companyId, String email);

    Page<WorkforceEmployee> findAllByCompanyIdAndActiveTrue(UUID companyId, Pageable pageable);
}
