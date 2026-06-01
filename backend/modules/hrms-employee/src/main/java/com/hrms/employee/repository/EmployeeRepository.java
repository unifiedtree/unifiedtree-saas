package com.hrms.employee.repository;

import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, UUID> {

    Optional<Employee> findByEmail(String email);

    Optional<Employee> findByEmployeeCode(String employeeCode);

    Page<Employee> findByDepartmentId(UUID departmentId, Pageable pageable);

    List<Employee> findByManagerId(UUID managerId);

    Page<Employee> findByCompanyId(UUID companyId, Pageable pageable);

    Page<Employee> findByEmploymentStatus(EmploymentStatus employmentStatus, Pageable pageable);

    @Query("SELECT e FROM Employee e WHERE e.companyId = :companyId AND e.employmentStatus = 'ACTIVE'")
    List<Employee> findActiveByCompany(@Param("companyId") UUID companyId);
}
