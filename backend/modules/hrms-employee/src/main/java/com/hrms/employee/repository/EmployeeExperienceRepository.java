package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeExperience;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface EmployeeExperienceRepository extends JpaRepository<EmployeeExperience, UUID> {

    List<EmployeeExperience> findByEmployeeIdOrderByStartDateDesc(UUID employeeId);
}
