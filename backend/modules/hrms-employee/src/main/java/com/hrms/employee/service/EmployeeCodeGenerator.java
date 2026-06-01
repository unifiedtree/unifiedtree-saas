package com.hrms.employee.service;

import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.stereotype.Component;

@Component
public class EmployeeCodeGenerator {

    private final EmployeeRepository employeeRepository;

    public EmployeeCodeGenerator(EmployeeRepository employeeRepository) {
        this.employeeRepository = employeeRepository;
    }

    /**
     * Generates the next employee code in the format EMP-0001.
     * Uses the current total employee count + 1 as the sequence number.
     * Note: In a high-concurrency environment, consider using a database sequence
     * or a distributed ID generator to avoid collisions.
     */
    public String generate() {
        long sequence = employeeRepository.count() + 1;
        return String.format("EMP-%04d", sequence);
    }
}
