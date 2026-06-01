package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeAddress;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeAddressRepository extends JpaRepository<EmployeeAddress, UUID> {

    List<EmployeeAddress> findByEmployeeId(UUID employeeId);

    Optional<EmployeeAddress> findByEmployeeIdAndAddressType(UUID employeeId, String addressType);
}
