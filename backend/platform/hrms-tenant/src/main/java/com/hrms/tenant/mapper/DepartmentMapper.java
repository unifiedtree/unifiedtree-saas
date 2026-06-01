package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.DepartmentRequest;
import com.hrms.tenant.dto.DepartmentResponse;
import com.hrms.tenant.entity.Department;

public interface DepartmentMapper {
    Department toEntity(DepartmentRequest request);
    DepartmentResponse toResponse(Department department);
    void updateEntity(DepartmentRequest request, Department department);
}

