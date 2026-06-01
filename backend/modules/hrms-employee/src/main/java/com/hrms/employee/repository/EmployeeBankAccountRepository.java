package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeBankAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeBankAccountRepository extends JpaRepository<EmployeeBankAccount, UUID> {

    List<EmployeeBankAccount> findByEmployeeId(UUID employeeId);

    Optional<EmployeeBankAccount> findByEmployeeIdAndPrimaryTrue(UUID employeeId);
}
