package com.hrms.employee.mapper;

import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.dto.EmployeeResponse;
import com.hrms.employee.dto.EmployeeSummaryResponse;
import com.hrms.employee.entity.Employee;

public interface EmployeeMapper {
    EmployeeResponse toResponse(Employee employee);
    EmployeeSummaryResponse toSummary(Employee employee);
    Employee toEntity(CreateEmployeeRequest request);
}

