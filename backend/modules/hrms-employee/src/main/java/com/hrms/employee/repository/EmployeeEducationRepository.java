package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeEducation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface EmployeeEducationRepository extends JpaRepository<EmployeeEducation, UUID> {

    List<EmployeeEducation> findByEmployeeIdOrderByEndYearDesc(UUID employeeId);
}
