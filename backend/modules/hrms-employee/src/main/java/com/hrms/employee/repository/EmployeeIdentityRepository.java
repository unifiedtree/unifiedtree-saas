package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeIdentity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeIdentityRepository extends JpaRepository<EmployeeIdentity, UUID> {

    Optional<EmployeeIdentity> findByEmployeeId(UUID employeeId);

    boolean existsByEmployeeId(UUID employeeId);
}
