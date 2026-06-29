package com.hrms.learning.repository;

import com.hrms.learning.entity.EmployeeSkill;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeSkillRepository extends JpaRepository<EmployeeSkill, UUID> {

    List<EmployeeSkill> findByEmployeeIdOrderBySkillNameAsc(UUID employeeId);

    Optional<EmployeeSkill> findByEmployeeIdAndSkillNameIgnoreCase(UUID employeeId, String skillName);
}
