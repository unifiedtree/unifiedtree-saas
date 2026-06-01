package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Designation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DesignationRepository extends JpaRepository<Designation, UUID> {
    List<Designation> findAllByCompanyIdAndActiveTrueOrderByTitleAsc(UUID companyId);
    List<Designation> findAllByCompanyIdAndDepartmentIdAndActiveTrueOrderByTitleAsc(UUID companyId, UUID departmentId);
    boolean existsByCompanyIdAndTitleIgnoreCase(UUID companyId, String title);
}
