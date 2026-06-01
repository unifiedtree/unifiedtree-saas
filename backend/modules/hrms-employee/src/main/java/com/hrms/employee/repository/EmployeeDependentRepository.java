package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeDependent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface EmployeeDependentRepository extends JpaRepository<EmployeeDependent, UUID> {

    List<EmployeeDependent> findByEmployeeId(UUID employeeId);

    List<EmployeeDependent> findByEmployeeIdAndNomineeTrue(UUID employeeId);
}
