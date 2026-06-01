package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Department;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkforceDepartmentRepository extends JpaRepository<Department, UUID> {
    List<Department> findAllByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);
    Optional<Department> findByCompanyIdAndNameIgnoreCase(UUID companyId, String name);
    boolean existsByCompanyIdAndNameIgnoreCase(UUID companyId, String name);
}
